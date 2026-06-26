# GPF Mapas V1.8 Mobile Estável

Esta versão foi refeita de forma mais simples para resolver o problema do mapa aparecer no PC e não aparecer no celular.

## Principais correções

- Tela do mapa refeita para celular.
- Removidas regras antigas que podiam zerar a altura do mapa.
- PDF renderizado com limite seguro para não sumir em iPhone/Android.
- Zoom com dois dedos preso dentro do mapa.
- Bloqueio do zoom da aba inteira.
- Qualidade ajustável: Leve, HD e Ultra.
- Se o celular não aguentar HD, o app muda para Leve automaticamente.
- Se PDF.js falhar, abre em modo nativo.
- Mantém GPS real para GeoPDF.
- Mantém pontos e CSV.

## Como testar

1. Suba esta pasta no GitHub Pages.
2. Abra no celular.
3. Aperte "Limpar cache".
4. Feche o app/navegador.
5. Abra de novo.
6. Importe o PDF.
7. Abra o mapa.
8. Teste primeiro com qualidade "HD".
9. Se não aparecer, mude para "Leve".
10. Use dois dedos em cima do mapa para zoom.

## Observação

O modo nativo do celular pode ficar mais nítido porque é o leitor próprio de PDF do aparelho.
O modo PDF.js usa canvas para conseguir colocar GPS e pontos em cima do mapa.
