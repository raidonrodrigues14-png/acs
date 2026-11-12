# Portal TACS

Sistema web simples para o **TACS** (Técnico/Agente Comunitário de Saúde) registrar e acompanhar as famílias do território na atenção primária, com cálculo automático e painel para o gestor.

Páginas estáticas (HTML + JavaScript puro), banco e login no **Supabase**, publicação na **Vercel**. Não há etapa de build.

## Módulos

| Página | Para quem | O que faz |
|---|---|---|
| `index.html` | Todos | Login e tela inicial com os cards dos módulos |
| `risco.html` | TACS | **Pontuação de Risco Familiar** (escala de Coelho-Savassi): sentinelas por pessoa, relação morador/cômodo, escore e risco, planilha por TACS e microárea, impressão da ficha por família |
| `paliativos.html` | TACS e equipe | **Cuidados Paliativos**: elegibilidade simplificada (Etapa 1) e SPICT-BR (Etapa 2), com resultado automático e impressão da ficha |
| `gestor.html` | Gestor | Painel somente leitura: indicadores, distribuição de risco, sentinelas, resumo por TACS e microárea, lista de famílias, exportação CSV |

### Regras de cálculo

**Risco familiar (Coelho-Savassi)**

- Cada sentinela pontua **por pessoa** da casa: acamado, deficiência física, deficiência mental, baixas condições socioeconômicas e desnutrição grave (3 pontos); drogadição e desemprego (2 pontos); analfabetismo, menores de 6 meses, maiores de 70 anos, hipertensão e diabetes (1 ponto).
- Relação morador/cômodo (moradores ÷ cômodos): maior que 1 = 3 pontos, igual a 1 = 2 pontos, menor que 1 = 0 ponto.
- Classificação: 0 a 4 = **RH** (risco habitual) · 5 a 6 = **R1** · 7 a 8 = **R2** · 9 ou mais = **R3**.

**Elegibilidade para cuidados paliativos** (PlanificaSUS; Maas 2013, Highet 2013, University of Edinburgh 2020)

- **Elegível:** pelo menos um indicador positivo no SPICT-BR.
- **Triagem positiva:** nenhum indicador no SPICT-BR, mas pelo menos um item da elegibilidade simplificada. O caso vai para discussão em reunião de equipe.
- **Sem indicativo:** nenhum item positivo.
- A pergunta surpresa é positiva quando a resposta é "Não, não ficaria surpreso".

O resultado apoia a decisão da equipe e não substitui a avaliação clínica.

## Estrutura

```
index.html        login e tela inicial
risco.html        pontuação de risco familiar
paliativos.html   elegibilidade para cuidados paliativos
gestor.html       painel do gestor
gestor.sql        tabela e permissões do gestor
paliativos.sql    tabela e permissões dos paliativos
vercel.json       (opcional) { "cleanUrls": true }
```

A URL e a chave pública do Supabase ficam nas constantes `SUPABASE_URL` e `SUPABASE_ANON_KEY`, no início do `<script>` de cada página.

## Como configurar

### 1. Supabase

1. Crie (ou reutilize) um projeto no Supabase.
2. Em **SQL Editor**, rode o SQL das tabelas de risco familiar (abaixo), depois o `gestor.sql` e o `paliativos.sql`. Antes de rodar o `gestor.sql`, troque o e-mail no final do arquivo pelo do gestor.
3. Em **Authentication → Users → Add user**, crie os usuários (um por TACS e um para o gestor) com **Auto Confirm User** marcado.
4. Em **Project Settings → API**, copie a **Project URL** e a chave **publishable** (`sb_publishable_...`).

**Tabelas de risco familiar**

```sql
create table public.planilhas_risco (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data date not null,
  acs text not null,              -- nome do TACS
  rua text,
  microarea text,
  total_familias int not null default 0,
  qtd_rh int not null default 0,
  qtd_r1 int not null default 0,
  qtd_r2 int not null default 0,
  qtd_r3 int not null default 0
);

create table public.familias_risco (
  id uuid primary key default gen_random_uuid(),
  planilha_id uuid not null references public.planilhas_risco(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  ordem int not null,
  prontuario text,
  nome text not null,
  acamado smallint not null default 0,
  deficiencia_fisica smallint not null default 0,
  deficiencia_mental smallint not null default 0,
  baixas_condicoes smallint not null default 0,
  desnutricao smallint not null default 0,
  drogadicao smallint not null default 0,
  desemprego smallint not null default 0,
  analfabetismo smallint not null default 0,
  menor_6_meses smallint not null default 0,
  maior_70_anos smallint not null default 0,
  hipertensao smallint not null default 0,
  diabetes smallint not null default 0,
  moradores int,
  comodos int,
  pontos_moradia smallint not null default 0,
  escore_total int not null,
  risco text not null
);

alter table public.planilhas_risco enable row level security;
alter table public.familias_risco enable row level security;

create policy "proprias planilhas" on public.planilhas_risco
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "proprias familias" on public.familias_risco
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Nas colunas das sentinelas fica a **quantidade de pessoas**, não os pontos. A coluna `acs` guarda o nome do TACS (o nome interno foi mantido).

### 2. Chaves no código

Em cada página (`index.html`, `risco.html`, `paliativos.html`, `gestor.html`):

```js
const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

### 3. Publicação (GitHub + Vercel)

```bash
git add .
git commit -m "mensagem"
git push
```

Na Vercel, importe o repositório (**Add New → Project**), sem comando de build e sem pasta de saída. Cada `git push` publica de novo em cerca de 30 segundos.

Para abrir `/gestor` sem a extensão, crie um `vercel.json` com `{ "cleanUrls": true }`.

## Permissões e segurança

- Cada TACS vê e edita **apenas o que registrou** (RLS por `user_id`).
- O **gestor** só lê os dados de todos, pela função `public.eh_gestor()` e pela tabela `public.gestores`. Para liberar outro gestor, insira o usuário em `gestores`.
- Quem não está logado é levado de volta ao login. Usuário sem cadastro de gestor vê "Sem permissão" no painel.
- A chave **publishable** pode ficar no código. **Nunca** coloque uma chave `sb_secret_` ou `service_role` no código nem no GitHub.
- Os dados incluem nomes de pacientes e informações de saúde. Trate-os conforme a LGPD, mantenha o login ativo e use senhas fortes.

## Usuários de e-mail fictício

Se os logins usam e-mails fictícios (por exemplo `@example.com`), a recuperação de senha por e-mail não funciona. Redefina a senha pelo painel do Supabase (**Authentication → Users**) e guarde as senhas em local seguro.

## Fontes

- Savassi LC, Lage JL, Coelho FL. Sistematização de um instrumento de estratificação de risco familiar: Escala de risco familiar de Coelho-Savassi. J Manag Prim Health Care. 2012;3(2):179-85.
- PlanificaSUS. Texto: instrumentos de elegibilidade para abordagem paliativa. Hidalgo GAO, Souza SE.
- Highet G, et al. Development and evaluation of the Supportive and Palliative Care Indicators Tool (SPICT). BMJ Support Palliat Care. 2013;4(3):285-90.
- Maas E, et al. What tools are available to identify people with palliative care needs in primary care. BMJ Support Palliat Care. 2013;3:444-51.
- University of Edinburgh. SPICT-BR (versão brasileira): <https://www.spict.org.uk/the-spict/spict-br/>
