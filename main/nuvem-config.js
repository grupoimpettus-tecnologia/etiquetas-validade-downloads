// Endereço da nuvem (Supabase) do sistema. A chave publicável é feita para
// ficar no aplicativo: o que cada computador pode fazer é controlado pelas
// regras de acesso (RLS) do banco para o usuário logado.
export const NUVEM_PADRAO = {
  url: 'https://brvqytarftsogyxdbicb.supabase.co',
  chave: 'sb_publishable_ODcI33Y6dIQHaQbPSOnb6Q_ldPIWLGP',
};

// Site seguro (HTTPS) do Painel de Gestão. A contagem pela câmera do celular
// fica na página contagem.html desse site (precisa de HTTPS para a câmera).
// Endereço neutro do cliente, na VPS (a cópia do site que a VPS baixa a cada
// 5 minutos): é o que aparece no QR, nos botões e no e-mail. O Painel do
// Proprietário e o serviço de e-mail ficam em outra origem, a do
// Proprietário (prazzo.179-197-234-103.sslip.io, ver EMAIL_URL).
export const PAINEL_URL = 'https://app.179-197-234-103.sslip.io/painel/';

// Serviço de e-mail do Prazzo (dados de acesso por e-mail: boas-vindas e nova
// senha provisória), na VPS, no mesmo endereço do Painel do Proprietário. Quem
// guarda a senha do e-mail (SMTP) é o serviço, nunca o app. Este arquivo também
// vai para o site (painel): nada de variável de ambiente aqui. A troca do endereço nos
// testes (ETIQUETAS_EMAIL_URL) fica no processo principal (main.js).
export const EMAIL_URL = 'https://prazzo.179-197-234-103.sslip.io/api/email';
