# BTC-OptionSentiment

**Volatility Sentiment Engine** — A dashboard that derives BTC market sentiment from the Deribit options volatility surface using **option skew** (25-delta risk reversal: Call IV − Put IV).

- **Positive skew** → Greed (calls expensive)  
- **Negative skew** → Fear (puts expensive)

## Stack

- **Backend:** Python (FastAPI), `aiohttp`, Pandas. Data from Deribit public API.
- **Frontend:** Next.js (App Router), Tailwind CSS, Framer Motion, Shadcn/UI.

## Quick start

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

- Backend: http://localhost:8000  
- Frontend: http://localhost:3000  
- API: `GET /sentiment` — cached skew + DVOL data (refreshed every 60s).

## Repo

**GitHub:** https://github.com/DanielKim03/BTC-OptionSentiment
