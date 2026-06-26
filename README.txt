# GPF Mapas V1.3 GPS Corrigido

Correções principais:

- Corrigido problema de abrir sempre em modo nativo no celular quando o PDF.js falha.
- Adicionadas 3 opções online de PDF.js: cdnjs, jsDelivr e unpkg.
- Renderização do PDF ajustada para celular, evitando canvas gigante em mapa A0.
- GPS agora usa getCurrentPosition primeiro e watchPosition depois.
- Avisos mais claros quando o GPS está ativo, mas o PDF está em modo nativo.
- Botão "Limpar cache" para remover versão antiga do PWA/Service Worker.
- Service Worker atualizado para buscar arquivos novos primeiro.

## Importante

Para o GPS aparecer sobre o mapa, precisa cumprir 3 coisas:

1. Abrir o app em HTTPS, por exemplo GitHub Pages.
2. O mapa precisa abrir em PDF.js, não em "Nativo".
3. O PDF precisa ser GeoPDF/georreferenciado.

Se aparecer "Nativo", o GPS pode até pegar sua latitude/longitude, mas não consegue desenhar sua posição em cima do mapa.

## Teste no celular

1. Suba esta pasta no GitHub Pages.
2. Abra o link HTTPS no celular.
3. Aperte "Limpar cache" uma vez.
4. Importe o PDF de mapa.
5. Abra o mapa.
6. Veja se o status mostra "PDF.js online", "PDF.js jsDelivr" ou "PDF.js unpkg".
7. Aperte "Ativar GPS".
8. Permita localização.
9. Aguarde alguns segundos ao ar livre.

## Para ficar 100% offline

Coloque estes arquivos dentro da pasta libs:

- libs/pdf.min.js
- libs/pdf.worker.min.js

Sem eles, o app usa internet para carregar PDF.js na primeira vez.
