// Termos de uso e política de privacidade (app do computador, celular e site).
// Ao mudar o texto, suba a VERSAO (data AAAA-MM-DD da publicação) e cadastre a
// mesma versão em public.versoes_termos (migration) ANTES de publicar: a nuvem
// só aceita versões cadastradas. Todos os usuários aceitam de novo, no app do
// computador, no celular ou na página termos.html do site.
export const VERSAO_TERMOS = '2026-10-14';

export const TERMOS = [
  {
    titulo: '1. Finalidade do sistema',
    texto:
      'O Prazzo é um sistema para identificar alimentos manipulados, controlar prazos de validade e rastrear a produção e o uso desses alimentos. Ele é fornecido à empresa que contratou o serviço (a "empresa contratante"), para uso nas suas marcas e unidades. O uso é restrito a colaboradores e parceiros autorizados pela empresa contratante.',
  },
  {
    titulo: '2. Acesso pessoal e intransferível',
    texto:
      'Seu login é individual. Não compartilhe sua senha nem deixe outra pessoa usar o sistema com o seu acesso. Tudo o que for feito com o seu login fica registrado em seu nome: etiquetas, contagens e pedidos de cadastro. As baixas (uso ou descarte) ficam registradas com data, hora, motivo, observação e a indicação de se foram feitas manualmente ou pela contagem. No celular, entre sempre com o seu próprio login. Em computador ou celular compartilhado, use "Sair" ao terminar o turno. Se achar que alguém conhece a sua senha, troque-a em "Trocar senha" e avise o administrador do sistema na sua empresa.',
  },
  {
    titulo: '3. Dados coletados',
    texto:
      'Registramos: do usuário, nome, e-mail, perfil de acesso (Master, Gestor ou Operador) e a marca e a unidade autorizadas (a senha não fica guardada de forma legível); de cada etiqueta, produto, quantidade, lote, setor, forma de conservação, nome de quem manipulou, número de rastreio, quem registrou, nome do computador usado e data e hora de manipulação, validade, impressão e baixa (uso ou descarte, com motivo e observação); das contagens, quem fez, início e fim, códigos lidos, resultado e, se for o caso, quem a desfez; dos pedidos de cadastro, quem pediu, de qual computador, e quem aprovou ou recusou, com data e hora; e, do aceite destes termos, versão, data e hora, onde foi feito (computador, celular ou site) e versão do app. Para segurança, os serviços de nuvem e de hospedagem também podem guardar registros técnicos de acesso, como data, hora e endereço de internet (IP). O sistema não usa localização nem microfone e não guarda fotos.',
  },
  {
    titulo: '4. Uso dos dados (LGPD)',
    texto:
      'A empresa contratante é a controladora dos dados: é ela quem decide para que e como eles são usados. O Prazzo atua como operador: trata os dados em nome da empresa contratante e segue as instruções dela. Os dados são usados só para identificar alimentos, controlar validades, rastrear a produção, apoiar auditorias e garantir a segurança dos alimentos. O tratamento se baseia no cumprimento de obrigações sanitárias (boas práticas de manipulação de alimentos) e no legítimo interesse da empresa contratante. O Prazzo não vende os dados nem os usa para outros fins. Eles só são compartilhados com os fornecedores de infraestrutura necessários ao funcionamento do sistema (como o provedor da nuvem e o serviço que hospeda o site e as atualizações), por obrigação legal, a pedido de autoridade sanitária ou por instrução da empresa contratante.',
  },
  {
    titulo: '5. Armazenamento e segurança',
    texto:
      'As informações ficam no computador em uso, para o sistema funcionar mesmo sem internet (com cópias de segurança automáticas nesse computador), e em servidor em nuvem localizado no Brasil (São Paulo). A comunicação com a nuvem é criptografada (HTTPS), e o login salvo no computador é protegido pela criptografia do Windows. O acesso é restrito por perfil: o Operador vê apenas a sua unidade; o Gestor, as unidades da sua marca; e o Master, todas as marcas e unidades da empresa contratante. Pelo sistema, não é possível apagar o histórico das etiquetas nem alterar o produto, as datas e o responsável de uma etiqueta já registrada. Na contagem pelo celular, a câmera serve só para ler o QR da etiqueta: a imagem não sai do aparelho, apenas o código lido é enviado. O site do painel e as atualizações do app são entregues por um serviço de hospedagem que pode ficar fora do Brasil e que não recebe os registros do sistema. O histórico é mantido pelo período necessário ao controle sanitário e às auditorias, conforme definido pela empresa contratante.',
  },
  {
    titulo: '6. Responsabilidades de uso',
    texto:
      'Você se compromete a registrar informações verdadeiras (produto, quantidade, datas e responsável), a dar baixa nos itens usados ou descartados e a não alterar nem reaproveitar etiquetas impressas. Não escreva dados pessoais desnecessários em campos livres, como observações. Use o sistema apenas para as atividades da empresa contratante. O uso indevido pode levar à suspensão do acesso e a medidas definidas pela empresa contratante.',
  },
  {
    titulo: '7. Seus direitos',
    texto:
      'Pela LGPD, você pode pedir, entre outros direitos, a confirmação de que seus dados são tratados, o acesso a eles, a correção de dados incompletos ou errados e informações sobre com quem eles são compartilhados. Como a empresa contratante é a controladora, faça o pedido a ela, pelo canal de privacidade (encarregado de dados) da empresa ou pelo administrador do sistema na sua empresa. Pedidos que chegarem ao Prazzo serão encaminhados à empresa contratante. Alguns registros, como o histórico das etiquetas, podem precisar ser guardados mesmo após um pedido de exclusão, para cumprir obrigações sanitárias e permitir auditorias. Estes termos podem ser atualizados; quando isso acontecer, um novo aceite será pedido no próximo acesso.',
  },
];
