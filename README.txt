# GPF Mapas V2.5 Offline GPS

Objetivo desta versão:

- Mapa + GPS + botão Localizar funcionando também sem internet.
- O app salva PDF.js no armazenamento interno do navegador.
- Depois que PDF.js estiver salvo, o app consegue abrir GeoPDF em modo GPS mesmo offline.
- O GPS do celular pode funcionar sem internet, desde que a localização do aparelho esteja ligada e o site tenha permissão.

## Como preparar o offline

1. Abra o app online pelo GitHub Pages.
2. Abra um mapa uma vez.
3. Aguarde aparecer/usar o mapa.
4. O app salva a biblioteca PDF.js no navegador.
5. Depois pode ficar sem internet e abrir o mapa novamente.

## Importante

Se abrir offline antes de preparar, o app pode cair no modo nativo.
Modo nativo fica bonito, mas não permite desenhar GPS em cima do mapa.

Para GPS em cima do mapa offline, precisa:
- app já carregado/preparado online uma vez;
- PDF.js salvo no navegador;
- PDF salvo no app;
- PDF ser GeoPDF;
- permissão de localização liberada;
- celular com localização/GPS ligado.

## Botão Localizar

O botão Localizar:
- pede GPS;
- mostra erro se o navegador bloquear;
- mostra se está fora do perímetro;
- centraliza o marcador se estiver dentro do mapa.
