FROM python:3.12-slim
RUN useradd -m -u 1000 app
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY . .
USER app
ENV MURMUR_DATA_DIR=/tmp/murmur-data MURMUR_MODEL_DIR=/tmp/murmur-models MURMUR_THREADS=2
EXPOSE 7860
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "7860", "--no-access-log"]
