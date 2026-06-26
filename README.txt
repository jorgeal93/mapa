# GPF Mapas V1.9 GPS Flutuante + Nítido

Correções desta versão:

- Botão de GPS flutuante dentro do mapa, sempre visível no celular.
- Botões flutuantes: GPS, Ir, + ponto GPS e Nítido.
- Opção de qualidade nova: Nítido.
- Qualidade padrão agora é Nítido.
- Se Nítido pesar, cai para Ultra, depois HD, depois Leve.
- Botão "Ver nativo" abre o PDF no leitor nativo do celular, que é mais nítido.
- Botão "Voltar GPS" volta para o modo PDF.js, onde GPS e pontos funcionam em cima do mapa.
- Mantém zoom com dois dedos, GPS real, GeoPDF, pontos e CSV.

## Importante sobre nitidez

O leitor nativo do celular quase sempre fica mais nítido porque ele redesenha o PDF como vetor.
O modo PDF.js usa canvas para conseguir colocar GPS e pontos por cima.
Por isso agora existem dois modos:

1. PDF.js/GPS: permite GPS e pontos em cima do mapa.
2. Nativo/Nítido: mapa mais bonito, mas sem GPS desenhado em cima.

## Como testar

1. Suba no GitHub Pages.
2. Abra no celular.
3. Aperte "Limpar cache".
4. Feche e abra novamente.
5. Importe o PDF.
6. Abra o mapa.
7. Use o botão flutuante "GPS".
8. Use "Nítido" para ver o mapa no leitor nativo.
9. Use "Voltar GPS" para retornar ao modo com GPS.
