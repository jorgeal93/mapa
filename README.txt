# GPF Mapas V1.2 GPS

App separado para testar mapas em PDF/GeoPDF com GPS real.

## O que entrou nesta versão

- Importar PDF/GeoPDF
- Detectar georreferenciamento do PDF quando existir
- Mostrar sua localização real no mapa se você estiver dentro do perímetro
- Botão `Ativar GPS`
- Botão `Ir para GPS`
- Botão `Salvar ponto GPS`
- Continua com zoom, arrastar, páginas e pontos
- Continua salvando mapas e pontos offline no navegador
- Exporta pontos em CSV com latitude/longitude quando o ponto vier do GPS

## Importante sobre GPS

Para o GPS aparecer em cima do mapa:

1. O PDF precisa ser GeoPDF/georreferenciado.
2. O app precisa abrir no modo PDF.js.
3. No celular, o site precisa estar em HTTPS, como GitHub Pages.
4. O usuário precisa permitir localização no navegador.

No VS Code com Live Server pelo computador, o GPS pode funcionar em `localhost`.
No celular usando `http://IP-DO-PC:5500`, normalmente o navegador bloqueia GPS porque não é HTTPS.

## PDF.js

A versão tenta carregar:

- `libs/pdf.min.js`
- `libs/pdf.worker.min.js`

Se esses arquivos não existirem, ela tenta carregar PDF.js online quando houver internet.

Para ficar 100% offline no campo, coloque esses dois arquivos dentro da pasta `libs/`.

## Teste recomendado

1. Extraia a pasta.
2. Abra no VS Code.
3. Rode com Live Server.
4. Teste online uma vez para carregar PDF.js se a pasta `libs/` estiver vazia.
5. Importe o GeoPDF.
6. Publique no GitHub Pages para testar GPS real no celular.
7. No celular, abra o app, permita localização e toque em `Ativar GPS`.

## Observação

PDF comum abre e aceita pontos manuais, mas não consegue encaixar o GPS no mapa.
GeoPDF permite encaixar o GPS no mapa porque tem coordenadas internas.
