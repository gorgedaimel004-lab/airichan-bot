# Airi-chan Waifu Bot (Messenger)

Bilingüe (ES/EN), voz automática (ElevenLabs), personalidad de experta en anime/manga.
Este proyecto está listo para Render (Node.js).

## Deploy en Render
1) Crea un nuevo **Servicio web**.
2) Origen: conecta GitHub y sube estos archivos (o crea repo nuevo y súbelos).
3) Runtime: Node.
4) Build Command: `npm install`
5) Start Command: `npm start`
6) Variables de entorno (Environment):
   - `VERIFY_TOKEN` = `AIRICHAN123` (o lo que desees)
   - `META_PAGE_TOKEN` = **token de página** de Facebook
   - `OPENAI_API_KEY` = tu clave
   - `ELEVEN_API_KEY` = tu clave
   - `BASE_URL` = después del primer deploy, coloca tu URL Render: `https://<tuapp>.onrender.com`

## Configurar Webhook en Meta
- URL: `https://<tuapp>.onrender.com/webhook`
- Verify Token: el mismo de `VERIFY_TOKEN`
- Suscripciones: `messages`, `messaging_postbacks`

## Probar
Envía un mensaje a tu página: Airi-chan responderá texto y audio.
