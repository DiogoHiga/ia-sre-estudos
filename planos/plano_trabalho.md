# 🏢 Plano de Trabalho: IA aplicada no dia a dia de SRE

> **Para quando você está no trabalho.** O foco é **observar, medir e aplicar** com dados reais da empresa. O conhecimento teórico vem do [plano de estudo](plano_estudo_casa.md), que anda **uma semana à frente** deste.
>
> **Tempo sugerido:** ~1 h/dia de "olhar de IA" (rotinas) + 1 bloco de 3–4 h/semana para o entregável da semana.

---

## ⚠️ Regras de ouro (antes de colar qualquer log numa IA)

1. **Use só ferramentas aprovadas pela empresa** (ex.: Copilot corporativo, Bedrock/Azure OpenAI da conta da empresa). **Nunca** cole logs de produção em ChatGPT/Gemini pessoais.
2. **Sanitize sempre:** remova tokens, senhas, IPs públicos, e-mails, CPFs e nomes de clientes.
3. **A IA sugere, você decide.** Em incidente real, valide toda conclusão da IA com evidência (métrica, log, trace).
4. **Registre tudo:** cada uso vira um dado para o seu caso de negócio (tempo economizado, acerto ou erro).

---

## 🔁 Rotinas fixas

### Diárias (~15–30 min no total)
| Quando | Rotina |
|---|---|
| Início do dia | Olhar os problems do Dynatrace das últimas 24 h e anotar no **diário de oportunidades** os repetitivos e os que exigiram investigação manual |
| Durante investigações | Usar a **biblioteca de prompts** (abaixo) para analisar logs/erros e cronometrar: *quanto tempo levaria sem IA?* |
| Fim do dia | 2 linhas no diário: "o que foi toil hoje?" e "qual dos 5 verbos (resumir, classificar, extrair, recomendar, gerar) ajudaria?" |

### Semanais (~1 h)
| Rotina | Saída |
|---|---|
| Revisar tickets/incidentes da semana | Atualizar a planilha de toil |
| 1 conversa de 15 min com um colega ("o que mais te irrita na operação?") | Novas ideias para o backlog |
| Atualizar métricas | Horas economizadas, acertos/erros da IA |

### Modelo do diário de oportunidades
```
Data | Situação | Tempo gasto | Toil? (S/N) | Verbo de IA | Ideia | Nota rápida (1-5)
```

---

## 🧰 Biblioteca de prompts para o trabalho

Guarde num repositório interno (ex.: `sre-ai-prompts`) e evolua com o tempo.

**1. Análise de log de erro**
```
Você é um SRE sênior. Analise o log abaixo de um serviço [linguagem/stack] rodando em [AKS/EKS].
Responda em tópicos:
1. Erro principal (cite as linhas)
2. Causa provável e nível de confiança (alto/médio/baixo)
3. O que verificar a seguir para confirmar (métricas, comandos kubectl, queries)
4. Mitigação imediata sugerida
Se faltar informação, diga o que precisa. Não invente.

LOG:
<<<
[cole aqui, sanitizado]
>>>
```

**2. Resumo de incidente / war room**
```
Resuma a thread de incidente abaixo para alguém que acabou de entrar:
- Status atual, impacto, hipóteses descartadas, hipótese atual, próximos passos e responsáveis.
Máximo de 10 linhas.
```

**3. Rascunho de postmortem**
```
Com base na timeline, nos alertas e nas ações abaixo, gere um rascunho de postmortem blameless com:
Resumo, Impacto, Timeline, Causa raiz, O que funcionou, O que não funcionou e Ações (com tipo: prevenir/detectar/mitigar).
```

**4. Pergunta → query DQL (Dynatrace)**
```
Escreva uma query DQL do Dynatrace para: [pergunta em português].
Explique cada linha. Considere que os logs têm os campos: [liste].
```

**5. Review de PR de Terraform/Helm**
```
Revise este diff de [Terraform/Helm] buscando: riscos de segurança, impacto em custo, falta de limits/requests,
mudanças destrutivas (replace/destroy) e violações de boas práticas. Classifique por severidade.
```

**6. Classificação de toil**
```
Classifique cada tarefa abaixo segundo os critérios de toil do Google SRE (manual, repetitiva, automatizável,
tática, sem valor duradouro, cresce com o serviço). Sugira se a solução é automação clássica, IA copiloto ou auto-remediação.
```

---

## 📅 Plano semanal (8 semanas)

### Semana 1: Raio-X do toil
**Objetivo:** saber, com números, onde o time perde tempo.
- [ ] Exportar os problems do Dynatrace dos últimos 90 dias e agrupar por tipo, serviço e frequência
- [ ] Levantar as execuções do Rundeck mais frequentes (quais jobs, quem roda, quantas vezes)
- [ ] Levantar as falhas de pipeline mais comuns no GitHub Actions
- [ ] Conversar com 3–5 colegas (plantonistas, principalmente)
- [ ] Abrir a conversa com Segurança/Compliance: *quais ferramentas de IA podemos usar com logs?*

**Entregável:** planilha de toil com o **top 10** priorizado pela matriz (dor, frequência, dados, risco, visibilidade).

### Semana 2: Análise de logs com IA (manual e medida)
**Objetivo:** provar o valor da IA com o que já está disponível, sem construir nada.
- [ ] Usar o prompt 1 em **todo** troubleshooting da semana (com a ferramenta aprovada)
- [ ] Registrar, para cada caso: tempo com IA × estimativa sem IA e se a IA acertou
- [ ] Testar o prompt 4 (DQL) para acelerar investigações no Dynatrace
- [ ] Criar o repositório `sre-ai-prompts` e compartilhar com o time

**Entregável:** mini-relatório com 5–10 casos reais: tempo economizado, acertos, erros e aprendizados.

### Semana 3: Quick win no CI
**Objetivo:** primeira automação de IA visível.
- [ ] Escolher o repositório com mais falhas de pipeline (da semana 1)
- [ ] Implementar o workflow de diagnóstico de falhas com Bedrock/GitHub Models (está no [plano turbo](plano_turbo_8_semanas.md)) — já testado em casa na semana 2 do estudo
- [ ] Coletar feedback dos devs: o diagnóstico ajudou?

**Entregável:** workflow em produção num repositório + **demo de 5 min** para o time/gestor.

### Semana 4: Alerta enriquecido (N0)
**Objetivo:** o alerta do Dynatrace chega ao chat já explicado.
- [ ] Configurar o webhook do Dynatrace para um ambiente/time piloto
- [ ] Subir o serviço N0 (problem → contexto → LLM → Teams/Slack)
- [ ] Botões 👍/👎 para medir a qualidade

**Entregável:** N0 rodando no piloto + taxa de acerto da primeira semana.

### Semana 5: Runbooks prontos para máquina
**Objetivo:** preparar o terreno para a IA executar ações.
- [ ] Converter os runbooks do top 5 de incidentes para o template com frontmatter (`job_id`, `risco`, `pre_condicoes`)
- [ ] Revisar os jobs do Rundeck correspondentes: idempotentes? ACL mínima? token dedicado?
- [ ] Usar o prompt 6 para reclassificar o backlog de toil com o que você aprendeu

**Entregável:** repositório `sre-runbooks` com 5 runbooks padronizados + 5 jobs prontos para chamar via API.

### Semana 6: Agente em dry-run
**Objetivo:** a IA diz o que faria, sem fazer.
- [ ] Rodar o agente LangGraph (construído em casa nas semanas 4–5 do estudo) em modo dry-run no piloto
- [ ] Comparar a sugestão do agente com o que o plantonista realmente fez

**Entregável:** taxa de concordância agente × humano.

### Semana 7: Aprovação com um clique (N1)
**Objetivo:** primeira ação real, sempre com humano aprovando.
- [ ] Habilitar a aprovação no chat para 1–2 runbooks de risco baixo
- [ ] Aplicar os guardrails: allowlist, rate limit, kill switch, auditoria no Dynatrace

**Entregável:** primeiras mitigações executadas via IA + log de auditoria.

### Semana 8: Resultado e próximos passos
- [ ] Consolidar métricas: MTTR antes × depois, horas de toil economizadas, acerto do N0/N1, custo de LLM
- [ ] Montar o backlog com 5–10 oportunidades (canvas de 1 página para cada)
- [ ] Apresentar à liderança: demos + números + pedido (pessoas, verba, escopo da próxima fase)

---

## 📊 Métricas para acompanhar desde a semana 1

| Métrica | Fonte |
|---|---|
| Horas de toil/semana (estimativa do time) | Planilha de toil |
| Tempo de troubleshooting com × sem IA | Diário de oportunidades |
| % de acerto da IA (logs, N0, dry-run) | Diário + 👍/👎 |
| MTTR dos incidentes do piloto | Dynatrace |
| Nº de oportunidades no backlog | Planilha |
