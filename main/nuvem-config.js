// Endereço da nuvem (Supabase) do sistema. A chave publicável é feita para
// ficar no aplicativo: o que cada computador pode fazer é controlado pelas
// regras de acesso (RLS) do banco para o usuário logado.
export const NUVEM_PADRAO = {
  url: 'https://brvqytarftsogyxdbicb.supabase.co',
  chave: 'sb_publishable_ODcI33Y6dIQHaQbPSOnb6Q_ldPIWLGP',
};

// Site seguro (HTTPS) do Painel de Gestão. A contagem pela câmera do celular
// fica na página contagem.html desse site (precisa de HTTPS para a câmera).
export const PAINEL_URL = 'https://grupoimpettus-tecnologia.github.io/etiquetas-validade-downloads/painel/';
