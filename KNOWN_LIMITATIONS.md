# PolyLance Architecture & Production Known Limitations

## Chat Microservice Cold Start (Render Free Hobby Tier)

The PolyLance Chat Microservice (`polylance-chat-service`) runs on Render's free Hobby tier.

- **Inactivity Spin-down**: After 15 minutes of zero active WebSocket / HTTP traffic, Render automatically spins down the container process.
- **Cold Start Delay**: The next incoming request or Socket.io connection attempt triggers a **30 to 60 second cold start** while Render spins up the container and initializes the PostgreSQL pool & historical contract event listeners.
- **MVP Acceptance**: This is an accepted tradeoff for zero-cost hosting during the MVP phase.
- **Production Scaling Path**: Upgrade the Render Web Service to the paid starter/standard tier ($7/month, zero code changes or migration required) once active user volume requires instant response times.
