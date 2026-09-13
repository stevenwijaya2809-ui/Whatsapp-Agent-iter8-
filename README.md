# WhatsApp AI Agent

A full-stack WhatsApp AI agent built with Next.js. It receives messages through the official Meta WhatsApp Business API, replies with an AI model through OpenRouter, and gives you a real-time dashboard to read every conversation and take over from the AI when needed.

## Architecture

```
User sends a WhatsApp message
  -> Meta forwards it to POST /api/webhook
  -> Message stored in Supabase; the webhook returns 200 immediately
  -> In the background (Agent mode only): recent history is sent to the AI model (OpenRouter)
  -> AI reply sent back via the Meta Graph API and stored in Supabase
  -> Dashboard updates in real time (Supabase Realtime)
```

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript)
- **Database:** Supabase (PostgreSQL + Realtime)
- **AI:** OpenRouter API (OpenAI-compatible SDK)
- **Styling:** Tailwind CSS 4

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Next.js reads `.env.local`, not `.env.example`. Keep real credentials in `.env.local` only (it is gitignored), and restart the dev server after changing it.

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Yes | Permanent token from Meta Business > System Users |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | From Meta App > WhatsApp > API Setup |
| `WHATSAPP_VERIFY_TOKEN` | Yes | Any string you choose; enter the same value in the Meta webhook settings |
| `WHATSAPP_APP_SECRET` | Recommended | Meta App > App settings > Basic > App secret. When set, webhook calls without a valid Meta signature are rejected |
| `OPENROUTER_API_KEY` | Yes | API key from openrouter.ai |
| `AI_MODEL` | Yes | OpenRouter model ID (e.g. `openai/gpt-4o-mini`) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key, used by the dashboard for Realtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key, used by the server only |

### 3. Set up the database

Run [`supabase-schema.sql`](supabase-schema.sql) in the Supabase SQL Editor (or apply it as a migration through the Supabase MCP server). It creates:

- `conversations`: one row per WhatsApp contact, with `mode` (`agent` or `human`) and `last_read_at` for unread indicators
- `messages`: every message, with `role` (`user` or `assistant`) and, for assistant messages, `sent_by` (`ai` or `human`)
- Row Level Security: the anon key gets read-only access (needed for Realtime), and all writes go through the server
- The Realtime publication for both tables

The script is idempotent: it is safe to run again, and it upgrades databases created from the original schema.

### 4. Run the dev server

```bash
npm run dev
```

### 5. Expose your local server

Use ngrok (or deploy to Vercel) to get a public URL:

```bash
ngrok http 3000
```

### 6. Configure the Meta webhook

1. Go to [Meta App Dashboard](https://developers.facebook.com) > your app > WhatsApp > Configuration
2. Set the webhook URL to `https://your-url.com/api/webhook`
3. Set the verify token to match your `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to the **messages** field

## How It Works

- **Agent mode** (default): the AI replies to every new message automatically.
- **Human mode**: incoming messages are stored but not answered; you reply from the dashboard. If you switch a conversation to Human mode while the AI is still generating, that reply is discarded.
- **Manual messages** can be sent from the dashboard in both modes. They are stored as assistant messages with `sent_by = 'human'` and labeled "You".
- **Reliable webhook**: incoming messages are stored before the webhook responds, so if the database is unavailable Meta retries the delivery. Redeliveries are ignored using the WhatsApp message ID. The AI reply runs after the response is sent (Next.js `after`), so Meta always gets a fast 200.
- **AI context**: the model sees the last 20 messages plus the system prompt in [`src/lib/system-prompt.ts`](src/lib/system-prompt.ts). Markdown in replies is converted to WhatsApp formatting, and replies longer than WhatsApp's 4096-character limit are split.
- **Non-text messages** (images, voice notes, locations, etc.) are stored as placeholders such as `[Image] caption`, so they show up in the dashboard and the AI knows something was sent.

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/webhook` | Meta webhook verification |
| POST | `/api/webhook` | Receive incoming WhatsApp messages |
| GET | `/api/conversations` | List conversations with their latest message |
| PATCH | `/api/conversations/[id]` | Update the mode (`{"mode": "human"}`) and/or mark as read (`{"read": true}`) |
| GET | `/api/conversations/[id]/messages` | The latest 500 messages of a conversation |
| POST | `/api/conversations/[id]/send` | Send a manual message from the dashboard (`{"message": "..."}`) |

## Dashboard Features

- **Sidebar:** conversations sorted by latest activity, with a mode badge (green Agent, orange Human), an unread dot for Human-mode conversations with new customer messages, and a live connection indicator
- **Chat panel:** WhatsApp-style bubbles labeled "AI" (green) or "You" (orange), with timestamps and day dividers
- **Mode toggle:** switch between Agent and Human per conversation
- **Message input:** available in both modes; Enter sends, Shift+Enter adds a new line, and WhatsApp API errors are shown inline
- **Real-time:** new messages appear instantly via Supabase Realtime, with a catch-up refresh after reconnecting
- **Mobile:** the conversation list and chat are shown as separate screens on narrow displays

## Security

- **The dashboard has no login.** Anyone who can reach its URL can read conversations and send WhatsApp messages. Add authentication before deploying it publicly.
- **Realtime uses the public anon key**, which the schema grants read-only access to both tables. The anon key is included in the page's JavaScript, so anyone who has it can read conversation data.
- **Set `WHATSAPP_APP_SECRET` in production** so that only Meta can call the webhook.
- **Never commit credentials.** `.env.local` is gitignored; `.env.example` is meant to be committed, so keep it free of real values.

## Deployment

Deploy to Vercel:

```bash
vercel
```

Then update your Meta webhook URL to point to your Vercel deployment. The webhook route sets `maxDuration = 60` so background AI replies have time to finish.

---

## Step-by-Step Setup Guide

Follow these steps in order to go from zero to a working WhatsApp AI agent.

### Step 1: Create a Meta Business App

1. Go to https://developers.facebook.com and log in
2. Click **My Apps** > **Create App**
3. Select **Business** as the app type
4. Give it a name (e.g. "WhatsApp AI Agent") and click **Create**
5. On the app dashboard, find **WhatsApp** and click **Set Up**
6. You'll be assigned a test phone number and a temporary access token

### Step 2: Get a Permanent Access Token

The temporary token expires in 24 hours. To get a permanent one:

1. Go to https://business.facebook.com/settings/system-users
2. Click **Add** to create a new System User (Admin role)
3. Click **Add Assets** > select your app > toggle **Full Control**
4. Click **Generate Token** > select your app > check `whatsapp_business_messaging` and `whatsapp_business_management`
5. Copy the token: this is your `WHATSAPP_ACCESS_TOKEN`

### Step 3: Get Your Phone Number ID and App Secret

1. Go to https://developers.facebook.com > your app > WhatsApp > **API Setup**
2. Under "From", you'll see your test phone number and its **Phone Number ID**
3. Copy it: this is your `WHATSAPP_PHONE_NUMBER_ID`
4. Go to **App settings** > **Basic** and copy the **App secret**: this is your `WHATSAPP_APP_SECRET`

### Step 4: Create a Supabase Project

1. Go to https://supabase.com and create a new project
2. Once created, go to **Project Settings** > **API**
3. Copy these values:
   - **Project URL** -> `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** -> `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role secret key** -> `SUPABASE_SERVICE_ROLE_KEY`
4. Go to **SQL Editor** and run the contents of [`supabase-schema.sql`](supabase-schema.sql)

### Step 5: Get an OpenRouter API Key

1. Go to https://openrouter.ai and create an account
2. Go to https://openrouter.ai/keys and create a new API key
3. Copy it: this is your `OPENROUTER_API_KEY`
4. Choose a model ID for `AI_MODEL` from https://openrouter.ai/models (e.g. `openai/gpt-4o-mini`)

### Step 6: Configure the Project

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create your `.env.local` file:
   ```bash
   cp .env.example .env.local
   ```

3. Fill in all the values you collected in Steps 2-5, and choose a `WHATSAPP_VERIFY_TOKEN`

### Step 7: Start the App

```bash
npm run dev
```

The app starts on http://localhost:3000. Open it in your browser: you should see the dashboard with an empty conversation list and a "Live" indicator.

### Step 8: Expose Your Local Server

Meta needs a public HTTPS URL to send webhooks to. Use ngrok:

```bash
# Install ngrok if you haven't: https://ngrok.com/download
ngrok http 3000
```

Copy the `https://` forwarding URL (e.g. `https://abc123.ngrok-free.app`).

### Step 9: Configure the Webhook in Meta

1. Go to https://developers.facebook.com > your app > WhatsApp > **Configuration**
2. Under "Webhook", click **Edit**
3. Set the **Callback URL** to: `https://your-ngrok-url.ngrok-free.app/api/webhook`
4. Set the **Verify Token** to the same value as your `WHATSAPP_VERIFY_TOKEN` in `.env.local`
5. Click **Verify and Save**
6. Under "Webhook Fields", click **Manage** and subscribe to **messages**

### Step 10: Add Your Phone Number to Recipients

If using the Meta test phone number:

1. Go to WhatsApp > API Setup
2. Under "To", add your personal WhatsApp phone number
3. You'll receive a verification code on WhatsApp: enter it to confirm

### Step 11: Send a Test Message

1. Open WhatsApp on your phone
2. Send a message to the Meta test phone number (shown in API Setup)
3. You should receive an AI-generated reply within a few seconds
4. Open the dashboard at http://localhost:3000: the conversation should appear in the sidebar

### Step 12: Deploy to Production (Optional)

1. Push your code to GitHub
2. Import the project on https://vercel.com
3. Add all your environment variables in Vercel's project settings
4. Deploy: Vercel will give you a production URL
5. Go back to Meta > WhatsApp > Configuration and update the webhook URL to your Vercel URL
6. Remove the ngrok dependency: you're live!

### Troubleshooting

| Problem | Solution |
|---|---|
| `Could not find the table 'public.conversations'` | Run `supabase-schema.sql` in the Supabase SQL Editor |
| `Missing environment variable ...` | Add it to `.env.local` and restart the dev server |
| Webhook verification fails | `WHATSAPP_VERIFY_TOKEN` must be set and match the value in the Meta dashboard exactly |
| Webhook returns 401 | `WHATSAPP_APP_SECRET` doesn't match your Meta app's App secret |
| Messages received but no AI reply | Check the server logs for `[webhook]` errors, check `OPENROUTER_API_KEY` and `AI_MODEL`, and make sure the conversation is in Agent mode |
| `WhatsApp API error 131030` | The recipient isn't in the test number's allowed list: add it under WhatsApp > API Setup |
| Dashboard shows "Offline" | Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and that `supabase-schema.sql` ran (it enables Realtime for both tables) |
| Manual message shows in the dashboard but never arrives | WhatsApp only allows free-form messages within 24 hours of the customer's last message; outside that window Meta rejects them after accepting the request |
#   W h a t s a p p - A g e n t - i t e r 8 -  
 