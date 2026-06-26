# GPF Mapas V1.6 Touch Fix

Correções:

- O zoom com dois dedos agora fica preso dentro do mapa.
- O navegador não deve mais aproximar a aba inteira.
- Adicionado bloqueio de gesturestart/gesturechange para iPhone/Safari.
- Adicionado touchstart/touchmove com passive:false direto no mapa.
- Arrastar com um dedo continua funcionando.
- Pinça com dois dedos aproxima/afasta o mapa.
- Mantém PDF.js, GPS, GeoPDF, pontos e CSV.

## Sobre nitidez

O modo nativo/offline fica mais nítido porque o celular usa o leitor de PDF próprio e redesenha o PDF vetorial.
No modo PDF.js o app renderiza em canvas. A V1.6 tenta redesenhar em HD depois do zoom, mas PDF muito grande pode exigir alguns segundos.

Para testar:

1. Suba no GitHub Pages.
2. Abra no celular.
3. Aperte "Limpar cache".
4. Feche e abra novamente.
5. Importe o PDF.
6. Abra o mapa.
7. Use dois dedos diretamente em cima do mapa.
