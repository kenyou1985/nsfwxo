FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app/ ./app/
COPY data/ ./data/
COPY run.py .

# Expose port
EXPOSE 8000

# Run
CMD ["python", "run.py"]
