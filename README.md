# Streamify — Real-Time Chat Application

A full-stack WhatsApp-inspired messaging platform built with **Next.js**, **Node.js**, **Socket.io**, and **MongoDB**. Supports real-time private and group messaging, voice/video calls via WebRTC, ephemeral stories, polls, push notifications, and multilingual UI across 11 languages.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?logo=mongodb&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.8-010101?logo=socket.io)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Installation](#installation)
  - [Running the App](#running-the-app)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Socket Events](#socket-events)
- [Multilingual Support](#multilingual-support)
- [Database Schema](#database-schema)
- [Contributing](#contributing)
- [License](#license)

---

## Features

### Messaging
- **Private & group chats** with real-time delivery
- **Rich message types** — text, image, video, audio, document, location, sticker, GIF, contact, and system messages
- **Reply, forward, edit, and delete** messages (delete for me / delete for everyone)
- **Emoji reactions** on messages
- **Polls** — create single or multi-vote polls with live results
- **Pinned messages** — pin important messages per chat
- **Disappearing messages** — auto-delete after 24 hours, 7 days, or 90 days
- **Typing indicators** and **read/delivery receipts** (privacy-aware)
- **In-chat camera capture** and media sharing (up to 50 MB)
- Swipe-to-reply gestures and long-press context menus

### Group Chat
- Create groups with name, description, and avatar
- Admin-based member management (add, remove, promote, demote)
- Group info editing and common-groups lookup between users

### Chat Management
- **Pin chats** (up to 3) and **mute chats** (8h / 1 week / always with auto-unmute)
- **Archive chats** — single, bulk, and "keep chats archived" setting
- **Clear** or **delete** chat history (single and bulk)
- **Per-chat wallpaper** selection (6 built-in presets + custom)

### Voice & Video Calls
- Peer-to-peer **audio and video calls** powered by WebRTC
- Full call lifecycle — ring, accept, reject, end — with call history
- In-call audio/video toggle and duration tracking
- Ringtone playback and network usage monitoring

### Status / Stories
- Post **image, video, or styled text** statuses with 24-hour auto-expiry
- View tracking — see who viewed your story
- Story ring UI with unviewed indicator and swipe navigation

### Push Notifications (FCM)
- Multi-device support with per-user FCM token management
- Contextual notifications for messages, reactions, calls, group events, polls, and status updates
- Platform-specific configs (Android channels, web push, APNs)
- Quick actions — Reply, Mark as Read, Call Back

### Privacy & Blocking
- Granular privacy settings — last seen, profile photo, about, groups, read receipts
- Block/unblock users — enforced across messaging, calls, signaling, and notifications
- Contact-based visibility filtering applied server-side

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS |
| **Backend** | Node.js, Express 5, TypeScript |
| **Real-time** | Socket.io 4.8 (client + server) |
| **Database** | MongoDB with Mongoose 9 ODM |
| **Auth** | Passwordless email OTP → JWT (access + refresh tokens) |
| **Media** | Cloudinary (via Multer, 50 MB limit) |
| **Calls** | WebRTC with STUN (Google public servers) |
| **Notifications** | Firebase Cloud Messaging (Admin SDK + Web SDK) |
| **i18n** | i18next + react-i18next (11 languages) |
| **PWA** | Web App Manifest with standalone display |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Client (Next.js)                    │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Chat UI │  │ Status UI │  │ Call UI  │  │Settings │ │
│  └────┬────┘  └─────┬─────┘  └────┬─────┘  └────┬────┘ │
│       │             │              │              │      │
│  ┌────┴─────────────┴──────────────┴──────────────┴───┐  │
│  │          Socket.io Client + REST (Axios)           │  │
│  └────────────────────────┬───────────────────────────┘  │
└───────────────────────────┼──────────────────────────────┘
                            │ WSS / HTTPS
┌───────────────────────────┼──────────────────────────────┐
│                    Server (Express)                       │
│  ┌────────────────────────┴───────────────────────────┐  │
│  │              Socket.io  +  REST API                │  │
│  └──┬────────┬────────┬──────────┬───────────┬────────┘  │
│     │        │        │          │           │           │
│  ┌──┴──┐ ┌──┴──┐ ┌───┴───┐ ┌───┴────┐ ┌────┴─────┐    │
│  │Auth │ │Chat │ │Status │ │ Calls  │ │ Upload   │    │
│  └──┬──┘ └──┬──┘ └───┬───┘ └───┬────┘ └────┬─────┘    │
│     └───────┴────────┴─────────┴────────────┘           │
│                        │                                 │
│  ┌─────────┐  ┌───────┴───────┐  ┌──────────────────┐  │
│  │MongoDB  │  │  Cloudinary   │  │  Firebase (FCM)  │  │
│  └─────────┘  └───────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **MongoDB** (local instance or Atlas)
- **Cloudinary** account (for media uploads)
- **Firebase** project (for push notifications)

### Environment Variables

Create a `.env` file in the `backend/` directory:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/streamify
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

Create a `.env.local` file in the `frontend/` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_FIREBASE_API_KEY=your_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_vapid_key
```

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/streamify.git
cd streamify

# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### Running the App

```bash
# Terminal 1 — Start the backend
cd backend
npm run dev

# Terminal 2 — Start the frontend
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:3000` and the backend API at `http://localhost:5000`.

---

## Project Structure

```
├── backend/
│   └── src/
│       ├── index.ts                 # Server entry point
│       ├── config/                  # Database, Cloudinary, env config
│       ├── controllers/             # Route handlers (auth, chat, call, status)
│       ├── middleware/               # JWT auth middleware
│       ├── models/                  # Mongoose schemas (User, Chat, Message, etc.)
│       ├── routes/                  # Express route definitions
│       ├── services/                # Notification & OTP services
│       ├── socket/                  # Socket.io event handlers
│       └── utils/                   # Helpers (upload, block checks)
│
├── frontend/
│   └── src/
│       ├── app/                     # Next.js pages (login, settings, home)
│       ├── components/              # UI components (chat, sidebar, status, call, ui)
│       ├── hooks/                   # Custom hooks (socket, WebRTC, gestures, etc.)
│       ├── lib/                     # API client, Firebase, i18n setup
│       ├── locales/                 # Translation files (11 languages)
│       ├── store/                   # React Context (Auth, Chat, Status)
│       ├── types/                   # TypeScript type definitions
│       └── utils/                   # Utility functions
│
├── DATABASE_SCHEMA.md               # Full database documentation
├── MULTILINGUAL_GUIDE.md            # i18n developer guide
└── README.md
```

---

## API Reference

### Authentication — `/api/auth`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/request-otp` | Send OTP to email |
| `POST` | `/verify-otp` | Verify OTP and receive JWT tokens |
| `POST` | `/refresh-token` | Refresh access token |
| `GET` | `/profile` | Get current user profile |
| `PUT` | `/profile` | Update profile (name, bio, avatar) |
| `POST` | `/logout` | Logout and invalidate token |
| `POST` | `/fcm-token` | Register FCM device token |
| `DELETE` | `/account` | Delete account permanently |

### Chats — `/api/chats`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | List all chats for the user |
| `POST` | `/private` | Get or create a private chat |
| `POST` | `/group` | Create a new group chat |
| `GET` | `/:chatId/messages` | Get paginated messages |
| `PUT` | `/:chatId` | Update group info |
| `POST` | `/:chatId/archive` | Archive a chat |
| `POST` | `/:chatId/mute` | Mute a chat (8h / 1w / always) |
| `POST` | `/:chatId/disappearing` | Set disappearing message timer |
| `DELETE` | `/:chatId` | Delete a chat |

### Calls — `/api/calls`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/initiate` | Start a new call |
| `POST` | `/:callId/accept` | Accept incoming call |
| `POST` | `/:callId/reject` | Reject incoming call |
| `POST` | `/:callId/end` | End active call |
| `GET` | `/history` | Get call history (paginated) |

### Status — `/api/status`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/` | Create a new status |
| `GET` | `/` | Get all visible statuses |
| `POST` | `/:statusId/view` | Mark status as viewed |
| `GET` | `/:statusId/viewers` | Get viewer list |
| `DELETE` | `/:statusId` | Delete a status |

> See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for full collection details and field definitions.

---

## Socket Events

### Client → Server

| Event | Description |
|-------|-------------|
| `message:send` | Send a message (text, media, poll, reply) |
| `message:forward` | Forward messages to multiple chats |
| `message:delivered` | Acknowledge message delivery |
| `message:read` | Mark messages as read |
| `message:react` | Toggle emoji reaction |
| `message:deleteForMe` | Delete message locally |
| `message:deleteForEveryone` | Delete message for all participants |
| `message:pin` / `message:unpin` | Pin or unpin a message |
| `poll:vote` | Vote on a poll option |
| `typing:start` / `typing:stop` | Typing indicator |
| `call:initiate` / `call:accept` / `call:reject` / `call:end` | Call lifecycle |
| `webrtc:offer` / `webrtc:answer` / `webrtc:ice-candidate` | WebRTC signaling |

### Server → Client

| Event | Description |
|-------|-------------|
| `user:online` / `user:offline` | Presence updates (privacy-filtered) |
| `message:new` | New incoming message |
| `message:deliveryUpdate` / `message:readUpdate` | Receipt status changes |
| `message:reactionUpdate` | Reaction added or removed |
| `message:deleted` / `message:deletedForEveryone` | Deletion events |
| `message:pinned` / `message:unpinned` | Pin state changes |
| `poll:updated` | Poll vote update |
| `typing:update` | Typing state broadcast |
| `call:incoming` / `call:accepted` / `call:rejected` / `call:ended` | Call events |
| `group:updated` | Group membership or info change |
| `chat:muteUpdated` / `chat:pinned` / `chat:unpinned` | Chat preference updates |

---

## Multilingual Support

The app supports **11 languages** out of the box:

| Language | Code | Language | Code |
|----------|------|----------|------|
| English | `en` | Gujarati | `gu` |
| Hindi | `hi` | Kannada | `kn` |
| Bengali | `bn` | Malayalam | `ml` |
| Marathi | `mr` | Punjabi | `pa` |
| Tamil | `ta` | Odia | `or` |
| Telugu | `te` | | |

Language can be changed from **Settings** and the preference persists across sessions. See [MULTILINGUAL_GUIDE.md](MULTILINGUAL_GUIDE.md) for instructions on adding new languages.

---

## Database Schema

The app uses **MongoDB** with 5 collections:

| Collection | Purpose |
|-----------|---------|
| `users` | User accounts, profiles, contacts, privacy settings |
| `chats` | Chat rooms (private & group) with participants and metadata |
| `messages` | All messages with support for replies, reactions, polls, and media |
| `files` | Uploaded file metadata (Cloudinary) |
| `blockedusers` | User block relationships |

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for complete field definitions, indexes, and sample data.

---

## Contributing

Contributions are welcome! To get started:

1. **Fork** the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "feat: add your feature"`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a **Pull Request**

Please follow the existing code style and include appropriate TypeScript types.

---


