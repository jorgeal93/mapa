# GPF Mapas V1.4 Mobile HD

Melhorias desta versão:

- Layout mais responsivo para celular.
- A tela do mapa fica maior no celular.
- Cabeçalho é ocultado quando o mapa está aberto para ganhar espaço.
- Controles do mapa viraram barra horizontal com rolagem no celular.
- PDF renderizado em qualidade maior.
- Zoom mais nítido em mapas grandes/A0.
- Zoom centralizado na tela ou no cursor.
- Botões com nomes menores para caber melhor no celular.
- Mantém GPS real, GeoPDF, pontos e exportação CSV.

## Por que a imagem ficava feia?

A versão anterior renderizava o PDF em escala leve para não travar no celular.
Isso deixava o mapa rápido, mas quando dava zoom os detalhes ficavam borrados.

Nesta V1.4 o app renderiza o PDF em uma resolução maior e mostra em tamanho menor por CSS.
Assim o zoom fica mais limpo.

## Para testar no celular

1. Suba a pasta no GitHub Pages.
2. Abra o app no celular.
3. Aperte "Limpar cache" uma vez.
4. Feche e abra o app novamente.
5. Importe o PDF.
6. Abra o mapa.
7. Teste zoom, arraste e GPS.

## Observação

Se o PDF for muito pesado, a primeira abertura pode demorar um pouco mais, porque agora a qualidade está maior.
