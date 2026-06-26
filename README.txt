# GPF Mapas V1.1 Offline

App separado para testar mapas em PDF no celular.

## O que mudou da V1 para V1.1

- Removido CDN obrigatório no index.html.
- O app tenta carregar PDF.js local em `libs/pdf.min.js`.
- O worker local esperado é `libs/pdf.worker.min.js`.
- Se os arquivos PDF.js não estiverem na pasta, o app abre PDF pelo visualizador nativo do navegador.
- Continua salvando PDFs e pontos no navegador/celular usando IndexedDB.
- Continua com PWA e Service Worker.

## Modo completo

Para o modo completo com canvas, páginas, zoom e pontos presos ao PDF, coloque na pasta `libs/`:

- pdf.min.js
- pdf.worker.min.js

Versão recomendada: pdfjs-dist 3.11.174.

## Modo nativo

Sem os arquivos da biblioteca, o app funciona em modo nativo:

- Abre PDF offline.
- Salva o PDF no navegador/celular.
- Permite criar pontos básicos.
- Exporta pontos em CSV.

Mas o controle de página/zoom fica por conta do navegador.

## Como testar

1. Extraia a pasta `gpf-mapas-v1.1-offline`.
2. Abra a pasta no VS Code.
3. Rode com Live Server.
4. Importe um PDF.
5. Abra o mapa.
6. Veja se aparece "PDF.js local" ou "Nativo" no topo.

## Observação

Neste pacote a pasta `libs/` está preparada. Os arquivos reais do PDF.js precisam ser colocados nela para ativar o modo completo sem CDN.
