#!/usr/bin/env python3
"""Development server entry point — Railway compatible"""

import os

import uvicorn

if __name__ == "__main__":
    # Railway sets PORT env var; fallback to 8000 for local dev
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )
