FROM node:22-slim

# Instalar dependências do sistema necessárias para o bot (como ffmpeg para stickers/vídeos)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    webp \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar arquivos de dependências
COPY package.json .

# Instalar dependências do Node.js
RUN npm install --legacy-peer-deps

# Copiar o restante do código
COPY . .

# Comando para iniciar o bot
# O --pairing-code é necessário para a primeira conexão
CMD ["node", "index.js", "--pairing-code"]
