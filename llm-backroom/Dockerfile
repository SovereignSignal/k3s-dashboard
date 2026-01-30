FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

ENV PORT=3001
ENV TEMPERATURE=0.9
ENV TOP_P=0.95
ENV MAX_TOKENS=256
ENV TURN_DELAY_MS=2000

EXPOSE 3001

CMD ["node", "server.js"]
