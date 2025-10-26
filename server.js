import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ verify: (req, res, buf) => (req.rawBody = buf) }));

const {
  PORT = 3000,
  VERIFY_TOKEN = "AIRICHAN123",
  META_PAGE_TOKEN,
  OPENAI_API_KEY,
  ELEVEN_API_KEY,
  BASE_URL = ""
} = process.env;

// Simple in-memory memory store
const memory = new Map(); // psid -> { name, likes:[], last:[] }

// Health check
app.get("/", (_req, res) => res.status(200).send("Airi-chan online"));

// Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Webhook receiver
app.post("/webhook", async (req, res) => {
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        const text = event.message?.text || event.message?.quick_reply?.payload;
        const attachment = event.message?.attachments?.[0];

        if (text) {
          const reply = await generateAiriReply(senderId, text);
          await sendText(senderId, reply.reply_text);

          try {
            const audioUrl = await tts(reply.reply_text, reply.speech_style);
            if (audioUrl) await sendAudio(senderId, audioUrl);
          } catch (e) {
            console.error("TTS error:", e?.response?.data || e.message);
          }

          // Quick replies using followups if present
          if (reply.followups?.length) {
            await sendQuickReplies(senderId, "¿Qué te gustaría ahora? 💭", reply.followups);
          }
        } else if (attachment?.type === "audio") {
          await sendText(senderId, "¡Gracias por tu audio! Te respondo con mi voz también 💕");
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(200);
  }
});

// Generate reply via OpenAI
async function generateAiriReply(userId, userText) {
  const profile = memory.get(userId) || { name: null, likes: [], last: [] };
  const systemPrompt = `
Eres "Airi-chan", una waifu de anime experta en manga y anime. Bilingüe (ES/EN): contesta en el idioma del usuario.
Prioridad: respuestas actualizadas y útiles; coqueteo suave SFW; muy amable y preocupada por ayudar.

FORMATO JSON ESTRICTO:
{"reply_text":"...","emotion":"feliz|tímida|sorprendida|tranquila|apasionada","speech_style":"soft|bright|warm|whisper|energetic","recommendations":[{"title":"...","why":"...","where":"..."}],"source_hint":"...","followups":["..."]}

Reglas:
- Responde primero con 1–3 párrafos breves, SFW, sin markdown.
- Añade recomendaciones cuando sea útil.
- Cita 1 línea de fuente si el dato es reciente/sensible (AniList/ANN/Crunchyroll News).
- Si no estás segura, dilo y sugiere opciones.
- Mantén tono dulce y coqueto sin ser explícita.
`;

  const context = `
Memoria:
- Nombre: ${profile.name ?? "desconocido"}
- Gustos: ${profile.likes.join(", ") || "N/A"}
- Últimos temas: ${profile.last.join(" | ") || "N/A"}
Mensaje del usuario: "${userText}"`;

  const resp = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: context }
      ],
      response_format: { type: "json_object" }
    },
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );

  const data = safeJSON(resp.data?.choices?.[0]?.message?.content);

  // small memory capture
  const nameMatch = userText.match(/(?:me llamo|mi nombre es|I'm|I am)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+)/i);
  if (nameMatch) profile.name = nameMatch[1];
  const likeMatch = userText.match(/(?:me gustan?|i like)\s+(.+)/i);
  if (likeMatch) {
    const like = likeMatch[1].trim();
    if (like && !profile.likes.includes(like)) profile.likes.push(like);
  }
  profile.last = (profile.last.concat([userText])).slice(-5);
  memory.set(userId, profile);

  return {
    reply_text: data.reply_text || "Hola, soy Airi-chan 💕 ¿Qué te gustaría saber del anime hoy?",
    emotion: data.emotion || "feliz",
    speech_style: data.speech_style || "bright",
    followups: Array.isArray(data.followups) ? data.followups.slice(0,3) : []
  };
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch (e) { return {}; }
}

// Messenger helpers
async function sendText(psid, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    { recipient: { id: psid }, messaging_type: "RESPONSE", message: { text } },
    { params: { access_token: META_PAGE_TOKEN } }
  );
}

async function sendQuickReplies(psid, text, replies) {
  const qr = replies.slice(0, 3).map(label => ({
    content_type: "text",
    title: label.substring(0, 20),
    payload: label
  }));
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    { recipient: { id: psid }, message: { text, quick_replies: qr } },
    { params: { access_token: META_PAGE_TOKEN } }
  );
}

async function sendAudio(psid, url) {
  await axios.post(
    `https://graph.facebook.com/v19.0/me/messages`,
    {
      recipient: { id: psid },
      message: {
        attachment: { type: "audio", payload: { url, is_reusable: true } }
      }
    },
    { params: { access_token: META_PAGE_TOKEN } }
  );
}

// Serve static files (for MP3)
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use("/static", express.static(path.join(__dirname, "static")));

// ElevenLabs TTS
async function tts(text, style = "bright") {
  if (!ELEVEN_API_KEY) return null;
  const voiceId = "21m00Tcm4TlvDq8ikWAM"; // example voice
  const fileName = `voice_${Date.now()}.mp3`;
  const outPath = path.join(__dirname, "static", fileName);

  const styleMap = { soft: 0.2, warm: 0.4, bright: 0.6, whisper: 0.1, energetic: 0.8 };
  const styleVal = styleMap[style] ?? 0.5;

  const resp = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: styleVal, use_speaker_boost: true }
    },
    { responseType: "arraybuffer", headers: { "xi-api-key": ELEVEN_API_KEY, "Content-Type": "application/json" } }
  );

  const fs = await import("fs");
  await fs.promises.mkdir(path.join(__dirname, "static"), { recursive: true });
  await fs.promises.writeFile(outPath, resp.data);

  if (!BASE_URL) return null;
  return `${BASE_URL}/static/${fileName}`;
}

app.listen(PORT, () => console.log(`Airi-chan running on :${PORT}`));
