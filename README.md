# caronline-sync

Synchronize public Telegram channel messages into Bale.ai messenger automatically.

## Features
- Scrapes messages from a public Telegram channel URL.
- Forwards messages to a specified Bale.ai chat/channel.
- Uses Docker for easy deployment and persistent caching.

## Prerequisites
- [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed.
- A Bale.ai account.

## Setup Instructions

### 1. Get Bale Bot Token
1. Open Bale.ai messenger.
2. Search for `@BotFather`.
3. Create a new bot and copy the **API Token**.

### 2. Configure the Project
1. Clone the repository:
   ```bash
   git clone https://github.com/tje3d/caronline-sync.git
   cd caronline-sync
   ```
2. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
3. Edit the `.env` file and set the following variables:
   - `BALE_BOT_TOKEN`: Your Bale bot token from BotFather.
   - `CHANNEL_URL`: The public Telegram channel URL (e.g., `https://t.me/s/caronline`).
   - `BALE_CHAT_ID`: The ID of the Bale chat or channel where messages should be sent.
   - `LIMIT`: (Optional) Maximum number of messages to process in one run.

### 3. Run with Docker Compose
Start the synchronization service in the background:
```bash
docker compose up -d
```

The app will build and start running based on the configuration in your `docker-compose.yml` and `.env` files.

## How it Works
The service periodically scrapes the public web interface of the specified Telegram channel and sends any new messages it finds to your Bale bot, which then forwards them to the target chat.
