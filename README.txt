# GPF Mapas V2.3 GPS Corrigido

Correção principal:

- O botão Localizar agora chama diretamente getCurrentPosition() no toque do usuário.
- Se o navegador pedir permissão, toque em Permitir.
- Se der erro, aparece uma caixa informando o motivo:
  - precisa de HTTPS;
  - permissão negada;
  - localização desligada no celular;
  - fora do perímetro do mapa;
  - PDF sem GeoPDF detectado.
- Depois que pega uma posição, o app inicia watchPosition para acompanhar.
- Se estiver dentro do perímetro do GeoPDF, o app mostra o marcador e centraliza no mapa.

## Para GPS funcionar no celular

Use o link HTTPS do GitHub Pages.
Se abrir por IP local tipo http://192.168... o GPS pode ser bloqueado.

## Teste

1. Suba no GitHub Pages.
2. No celular, limpe o cache pela tela inicial.
3. Feche e abra o navegador.
4. Abra o mapa.
5. Toque em Localizar.
6. Toque em Permitir.
