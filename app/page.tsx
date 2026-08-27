"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle, BellRing, CalendarClock, CalendarDays, Check, Copy,
  CheckCircle2, ChevronRight, CircleDollarSign, ClipboardCheck, ClipboardList, Clock3,
  Eye, EyeOff, FileImage, HandCoins, Headphones, History, LayoutDashboard,
  Loader2, LockKeyhole, LogOut, Mail, MessageCircle, Paperclip, PauseCircle, Plus,
  Info, PlayCircle, RefreshCw, Search, Send, ShieldCheck, Sparkles, UserCheck, UsersRound, UserX,
  WalletCards, X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { caseCode, formatDate, formatDateTime, money, normalizeWhatsapp, whatsappUrl } from "./lib/format";
import type {
  AuditEvent, CaseAttachment, CaseOrder, CaseUpdate, CustomerMood, NevCase, NevCustomer, NevTask,
  OrderSystem, Priority, Profile, RefundInstallment, RefundPlan, ResolutionType, ReviewStatus,
  TaskUpdate, UserRole,
} from "./lib/types";

type Tab = "dashboard" | "action" | "cases" | "tasks" | "refunds" | "audit" | "team";

const reviewLabels: Record<ReviewStatus, string> = {
  draft: "Preparando conferência", pending: "Aguardando conferência",
  approved: "Conferido e liberado", changes_requested: "Ajustes solicitados",
};
const priorityLabels: Record<Priority, string> = { low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente" };
const issueLabels: Record<string, string> = {
  thai_order: "Pedido tailandês", missing_item: "Produto não recebido", wrong_item: "Produto incorreto",
  quality: "Problema de qualidade", refund: "Solicitação de reembolso", other: "Outro",
};
const resolutionLabels: Record<ResolutionType, string> = {
  store_credit: "Crédito em produtos", store_credit_venduss: "Crédito para pedido na Venduss",
  store_credit_zero19: "Crédito para pedido na Zero19", reorder: "Refazer pedido",
  installment_refund: "Reembolso parcelado", other: "Outra solução",
};
const attachmentLabels: Record<CaseAttachment["category"], string> = {
  payment_receipt: "Comprovante de pagamento", shipping: "Envio da mercadoria",
  problem: "Imagem do problema", other: "Outro anexo",
};
const moodLabels: Record<CustomerMood, string> = {
  very_upset: "Muito irritado", upset: "Irritado", normal: "Normal", calm: "Tranquilo, de boa",
};
const moodEmoji: Record<CustomerMood, string> = { very_upset: "😡", upset: "😟", normal: "😐", calm: "🙂" };
const stageLabels: Record<NevCase["workflow_stage"], string> = {
  in_service: "Em atendimento", awaiting_internal_action: "Aguardando ação interna",
  options_released: "Opções liberadas", waiting_customer: "Aguardando cliente",
  completed: "Concluído", renegotiating: "Em renegociação",
};

function daysWithProblem(date: string) {
  const start = new Date(`${date.slice(0, 10)}T12:00:00`).getTime();
  return Math.max(0, Math.floor((Date.now() - start) / 86400000));
}

function recommendedPriority(orderDate: string, mood: CustomerMood, openCount: number): Priority {
  const days = daysWithProblem(orderDate);
  const score = (days >= 30 ? 3 : days >= 15 ? 2 : days >= 7 ? 1 : 0) + (mood === "very_upset" ? 2 : mood === "upset" ? 1 : 0) + (openCount >= 10 ? 1 : 0);
  return score >= 4 ? "urgent" : score >= 2 ? "high" : "normal";
}

function personName(profiles: Profile[], id: string | null) {
  const person = profiles.find((item) => item.user_id === id);
  return person?.full_name || person?.email || "Usuário";
}

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <div className={`brand ${inverse ? "brand--inverse" : ""}`}><span className="brand__mark"><Sparkles size={20} /></span><span className="brand__text"><strong>Nova Era</strong><small>VENDUSS</small></span></div>;
}

function useModalLock() {
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    html.classList.add("modal-open");
    body.classList.add("modal-open");
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      html.classList.remove("modal-open");
      body.classList.remove("modal-open");
      body.style.position = "";
      body.style.top = "";
      body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, []);
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useModalLock();
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal ${wide ? "modal--details" : "modal--form"}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal__header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button></header>
      {children}
    </section>
  </div>;
}

function CenteredLoader({ label = "Carregando..." }: { label?: string }) {
  return <main className="centered-screen"><Brand /><div className="loader-line"><Loader2 className="spin" size={20} />{label}</div></main>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage({ kind: "error", text: error.message.toLowerCase().includes("invalid login") ? "E-mail ou senha incorretos." : error.message });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin } });
      if (error) setMessage({ kind: "error", text: error.message });
      else if (!data.session) setMessage({ kind: "success", text: "Cadastro recebido. Confirme o e-mail e aguarde a aprovação." });
    }
    setBusy(false);
  }

  return <main className="auth-page">
    <section className="auth-story"><div><Brand inverse /><div className="auth-story__copy"><span className="eyebrow eyebrow--light">CENTRAL OPERACIONAL</span><h1>Cada pendência com dono, prazo e solução.</h1><p>Atendimentos, conferências, anexos, tarefas e reembolsos em um fluxo claro para toda a equipe.</p></div></div><div className="auth-proof"><span className="auth-proof__icon"><ShieldCheck size={20} /></span><div><strong>Dados protegidos</strong><small>Anexos privados e permissões por usuário.</small></div></div></section>
    <section className="auth-panel"><div className="auth-card"><div className="auth-card__mobile-brand"><Brand /></div><div className="auth-card__heading"><span className="eyebrow">ÁREA DA EQUIPE</span><h2>{mode === "login" ? "Entre no sistema" : "Crie seu acesso"}</h2><p>{mode === "login" ? "Continue de onde a equipe parou." : "O administrador aprova o acesso após o cadastro."}</p></div>
      <form onSubmit={submit} className="form-stack">
        {mode === "signup" && <label className="field"><span>Nome completo</span><div className="input-wrap"><UsersRound size={18} /><input autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Seu nome" required /></div></label>}
        <label className="field"><span>E-mail</span><div className="input-wrap"><Mail size={18} /><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></div></label>
        <label className="field"><span>Senha</span><div className="input-wrap"><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" minLength={6} required /><button className="icon-button icon-button--inside" type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Mostrar senha">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        {message && <div className={`form-message form-message--${message.kind}`}>{message.text}</div>}
        <button className="button button--primary button--full" disabled={busy}>{busy && <Loader2 className="spin" size={18} />}{mode === "login" ? "Entrar" : "Criar acesso"}</button>
      </form>
      <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(null); }}>{mode === "login" ? "Primeiro acesso? Cadastre-se" : "Já possui acesso? Entrar"}</button>
    </div></section>
  </main>;
}

function AccessState({ profile, bootstrap, onReload, onSignOut }: { profile?: Profile | null; bootstrap?: boolean; onReload: () => void; onSignOut: () => void }) {
  const [token, setToken] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function activate(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const { error: claimError } = await supabase.rpc("nev_claim_access", { p_bootstrap_token: token.trim() });
    if (claimError) setError(claimError.message); else onReload(); setBusy(false);
  }
  return <main className="centered-screen setup-screen"><Brand /><section className="setup-card"><span className={`setup-card__icon ${bootstrap ? "" : "setup-card__icon--amber"}`}>{bootstrap ? <ShieldCheck size={24} /> : <Clock3 size={24} />}</span><span className="eyebrow">{bootstrap ? "CONFIGURAÇÃO INICIAL" : "ACESSO EM ANÁLISE"}</span><h1>{bootstrap ? "Ative o administrador" : "Cadastro recebido"}</h1><p>{bootstrap ? "Digite a chave inicial entregue com o sistema." : `Olá, ${profile?.full_name?.split(" ")[0] || "atendente"}. Um administrador precisa liberar seu acesso.`}</p>
    {bootstrap ? <form className="form-stack" onSubmit={activate}><label className="field"><span>Chave inicial</span><input value={token} onChange={(e) => setToken(e.target.value)} required /></label>{error && <div className="form-message form-message--error">{error}</div>}<button className="button button--primary button--full" disabled={busy}>{busy && <Loader2 className="spin" size={17} />}Ativar</button></form> : <button className="button button--primary button--full" onClick={onReload}><RefreshCw size={17} /> Verificar aprovação</button>}
    <button className="text-button" onClick={onSignOut}>Sair e usar outra conta</button></section></main>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) { return <span className={`soft-badge soft-badge--${tone}`}>{children}</span>; }
function PriorityBadge({ priority }: { priority: Priority }) { return <span className={`priority priority--${priority}`}><i />{priorityLabels[priority]}</span>; }
function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) { return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div>; }
function StatCard({ label, value, detail, icon, tone }: { label: string; value: string | number; detail: string; icon: ReactNode; tone: string }) { return <article className="stat-card"><div className={`stat-card__icon stat-card__icon--${tone}`}>{icon}</div><div className="stat-card__content"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></article>; }

function TutorialCard({ tutorialKey, dismissed, title, children, onDismiss }: { tutorialKey: string; dismissed: Set<string>; title: string; children: ReactNode; onDismiss: (key: string) => void }) {
  if (dismissed.has(tutorialKey)) return null;
  return <section className="tutorial-card"><span className="tutorial-card__icon"><Info size={19} /></span><div><strong>{title}</strong><p>{children}</p></div><button className="button button--ghost" onClick={() => onDismiss(tutorialKey)}>Entendi</button></section>;
}

async function uploadCaseFiles(caseId: string, files: File[], category: CaseAttachment["category"], profile: Profile) {
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: limite de 10 MB.`);
    const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${caseId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("nev-case-files").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: rowError } = await supabase.from("nev_case_attachments").insert({ case_id: caseId, uploaded_by: profile.user_id, category, storage_path: path, original_name: file.name, mime_type: file.type || "image/jpeg", size_bytes: file.size });
    if (rowError) { await supabase.storage.from("nev-case-files").remove([path]); throw rowError; }
    await supabase.from("nev_case_updates").insert({ case_id: caseId, author_id: profile.user_id, kind: "attachment", body: `${attachmentLabels[category]} anexado: ${file.name}` });
  }
}

type OrderDraft = { key: string; system_id: string; system_label: string; order_number: string; order_date: string; amount: string };

function newOrderDraft(systemId = "__other__"): OrderDraft {
  return { key: crypto.randomUUID(), system_id: systemId, system_label: "", order_number: "", order_date: new Date().toISOString().slice(0, 10), amount: "" };
}

function NewCaseModal({ profile, profiles, customers, orderSystems, openCount, onClose, onCreated }: { profile: Profile; profiles: Profile[]; customers: NevCustomer[]; orderSystems: OrderSystem[]; openCount: number; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<OrderDraft[]>(() => [newOrderDraft(orderSystems[0]?.id)]);
  const [issue, setIssue] = useState("other"); const [priority, setPriority] = useState<Priority>("normal"); const [description, setDescription] = useState("");
  const [step, setStep] = useState<"details" | "finish">("details"); const [mood, setMood] = useState<CustomerMood | "">("");
  const [nextStep, setNextStep] = useState<"in_service" | "request_action">("in_service");
  const [actionUser, setActionUser] = useState(() => profiles.find((person) => person.active && person.user_id !== profile.user_id && person.is_super_admin)?.user_id || profiles.find((person) => person.active && person.user_id !== profile.user_id)?.user_id || ""); const [actionNote, setActionNote] = useState(""); const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState<CaseAttachment["category"]>("problem"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const normalized = normalizeWhatsapp(phone);
  const duplicate = normalized.length >= 10 ? customers.find((customer) => customer.normalized_whatsapp === normalized) : undefined;
  const reviewers = profiles.filter((person) => person.active && person.user_id !== profile.user_id);
  const orderTotal = orders.reduce((sum, order) => sum + (Number(order.amount.replace(",", ".")) || 0), 0);
  const oldestOrderDate = orders.map((order) => order.order_date).filter(Boolean).sort()[0] || new Date().toISOString().slice(0, 10);

  function updateOrder(key: string, field: keyof Omit<OrderDraft, "key">, value: string) {
    setOrders((current) => current.map((order) => order.key === key ? { ...order, [field]: value } : order));
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (step === "details") { setStep("finish"); return; }
    if (!mood) { setError("Selecione como o cliente está se sentindo."); return; }
    if (nextStep === "request_action" && (!actionUser || !actionNote.trim())) { setError("Escolha quem precisa agir e explique a ação."); return; }
    setBusy(true);
    const preparedOrders = orders.map((order) => ({ system_id: order.system_id === "__other__" ? null : order.system_id, system_label: order.system_id === "__other__" ? order.system_label.trim() : null, order_number: order.order_number.trim(), order_date: order.order_date, amount: Number(order.amount.replace(",", ".")) }));
    const { data, error: createError } = await supabase.rpc("nev_create_case_flow", { p_customer_name: name.trim(), p_whatsapp: normalized, p_issue_type: issue, p_description: description.trim(), p_priority: priority, p_assigned_to: profile.user_id, p_orders: preparedOrders, p_customer_mood: mood, p_next_step: nextStep, p_action_user: nextStep === "request_action" ? actionUser : null, p_action_note: nextStep === "request_action" ? actionNote.trim() : null });
    const created = Array.isArray(data) ? data[0] : data;
    if (createError || !created) { setError(createError?.message || "Não foi possível criar o atendimento."); setBusy(false); return; }
    try {
      if (files.length) await uploadCaseFiles(created.id, files, category, profile);
      onCreated();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Falha ao anexar arquivos."); }
    setBusy(false);
  }

  return <Modal title={step === "details" ? "Iniciar atendimento" : "Como o cliente está agora?"} eyebrow={step === "details" ? "NOVO REGISTRO" : "ETAPA OBRIGATÓRIA · 2 DE 2"} onClose={onClose} wide><form onSubmit={submit} className="modal__body form-grid">
    {step === "details" ? <>
    <label className="field"><span>Cliente</span><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
    <label className="field"><span>WhatsApp com DDD</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
    {duplicate && <div className="duplicate-warning field--wide"><AlertTriangle size={18} /><div><strong>Cliente já cadastrado</strong><span>O novo atendimento será vinculado ao cadastro de {duplicate.name}; não será criado cliente duplicado.</span></div></div>}
    <section className="orders-editor field--wide"><div className="orders-editor__head"><div><span className="eyebrow">PEDIDOS VINCULADOS</span><h3>Dados do pedido</h3></div><button type="button" className="button button--ghost" onClick={() => setOrders((current) => [...current, newOrderDraft(orderSystems[0]?.id)])}><Plus size={16} /> Adicionar pedido</button></div>
      {orders.map((order, index) => <article className="order-editor-row" key={order.key}><div className="order-editor-row__title"><strong>Pedido {index + 1}</strong>{orders.length > 1 && <button type="button" className="icon-button" aria-label={`Remover pedido ${index + 1}`} onClick={() => setOrders((current) => current.filter((item) => item.key !== order.key))}><X size={17} /></button>}</div><label className="field"><span>Sistema do pedido</span><select value={order.system_id} onChange={(e) => updateOrder(order.key, "system_id", e.target.value)} required><option value="__other__">Outro sistema</option>{orderSystems.map((system) => <option value={system.id} key={system.id}>{system.label}</option>)}</select></label>{order.system_id === "__other__" && <label className="field"><span>Nome do sistema</span><input value={order.system_label} onChange={(e) => updateOrder(order.key, "system_label", e.target.value)} placeholder="Informe o sistema" required /></label>}<label className="field"><span>Número do pedido</span><input value={order.order_number} onChange={(e) => updateOrder(order.key, "order_number", e.target.value)} placeholder="Ex.: 12345" required /></label><label className="field"><span>Data do pedido</span><input type="date" value={order.order_date} onChange={(e) => updateOrder(order.key, "order_date", e.target.value)} required /></label><label className="field"><span>Valor do pedido</span><input inputMode="decimal" value={order.amount} onChange={(e) => updateOrder(order.key, "amount", e.target.value)} placeholder="0,00" required /></label></article>)}
      <div className="order-total"><span>Total dos {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}</span><strong>{money.format(orderTotal)}</strong></div>
    </section>
    <label className="field"><span>Problema</span><select value={issue} onChange={(e) => setIssue(e.target.value)}>{Object.entries(issueLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="field field--wide"><span>Descrição do problema</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} required /></label>
    <label className="field"><span>Tipo dos anexos</span><select value={category} onChange={(e) => setCategory(e.target.value as CaseAttachment["category"])}>{Object.entries(attachmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="field file-field"><span>Imagens ou PDF</span><input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /><small>{files.length ? `${files.length} arquivo(s) selecionado(s)` : "Até 10 MB por arquivo"}</small></label>
    {error && <div className="form-message form-message--error field--wide">{error}</div>}
    <footer className="modal__actions field--wide"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary">Continuar <ChevronRight size={17} /></button></footer>
    </> : <>
      <div className="mood-intro field--wide"><span className="mood-intro__face">{mood ? moodEmoji[mood] : "💬"}</span><div><strong>Registre o clima desta conversa</strong><p>Isso fica destacado para Clovis decidir a prioridade e as opções de solução.</p></div></div>
      <div className="mood-grid field--wide">{(Object.keys(moodLabels) as CustomerMood[]).map((value) => <button type="button" className={`mood-choice mood-choice--${value} ${mood === value ? "is-selected" : ""}`} key={value} onClick={() => { setMood(value); setPriority(recommendedPriority(oldestOrderDate, value, openCount)); }}><span>{moodEmoji[value]}</span><strong>{moodLabels[value]}</strong></button>)}</div>
      {mood && <div className="priority-recommendation field--wide"><div><span>Prioridade sugerida</span><strong>{priorityLabels[recommendedPriority(oldestOrderDate, mood, openCount)]}</strong><small>{daysWithProblem(oldestOrderDate)} dias desde o pedido · {openCount} atendimentos abertos</small></div><label className="field"><span>Jean pode alterar</span><select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>}
      <div className="next-step-picker field--wide"><button type="button" className={nextStep === "in_service" ? "is-selected" : ""} onClick={() => setNextStep("in_service")}><PlayCircle size={21} /><div><strong>Continuar em atendimento</strong><small>O caso permanece com você enquanto conversa com o cliente.</small></div></button><button type="button" className={nextStep === "request_action" ? "is-selected" : ""} onClick={() => setNextStep("request_action")}><BellRing size={21} /><div><strong>Solicitar uma ação</strong><small>Envia alerta para Clovis ou outro usuário.</small></div></button></div>
      {nextStep === "request_action" && <><label className="field"><span>Quem precisa agir?</span><select value={actionUser} onChange={(e) => setActionUser(e.target.value)} required><option value="">Selecione</option>{reviewers.map((person) => <option value={person.user_id} key={person.user_id}>{person.is_super_admin ? "Clovis · administrador geral" : person.full_name || person.email}</option>)}</select></label><label className="field field--wide"><span>O que essa pessoa precisa fazer?</span><textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} rows={3} placeholder="Ex.: conferir chargeback e liberar as opções de conclusão." required /></label></>}
      {error && <div className="form-message form-message--error field--wide">{error}</div>}
      <footer className="modal__actions field--wide"><button type="button" className="button button--ghost" onClick={() => setStep("details")}>Voltar</button><button className="button button--primary" disabled={busy || !mood}>{busy ? <Loader2 className="spin" size={17} /> : nextStep === "request_action" ? <Send size={17} /> : <CheckCircle2 size={17} />}{nextStep === "request_action" ? "Criar e solicitar ação" : "Criar em atendimento"}</button></footer>
    </>}
  </form></Modal>;
}

function CaseList({ cases, onOpen }: { cases: NevCase[]; onOpen: (item: NevCase) => void }) {
  if (!cases.length) return <EmptyState icon={<ClipboardList size={24} />} title="Nenhum atendimento" text="Os registros aparecerão aqui." />;
  return <div className="case-list"><div className="case-table case-table--head"><span>Cliente</span><span>Problema</span><span>Tempo</span><span>Humor atual</span><span>Etapa</span><span>Prioridade</span><span /></div>{cases.map((item) => { const days = daysWithProblem(item.problem_started_at); return <button className={`case-table case-table--row ${item.workflow_stage === "awaiting_internal_action" ? "row-attention" : ""}`} key={item.id} onClick={() => onOpen(item)}><span className="case-customer"><i>{item.customer_name[0]?.toUpperCase()}</i><span><strong>{item.customer_name}</strong><small>{caseCode(item.case_number)} · {formatDate(item.created_at)}</small></span></span><span className="case-issue"><strong>{issueLabels[item.issue_type] || "Outro"}</strong><small>{item.issue_description}</small></span><span className={`problem-age ${days >= 15 ? "problem-age--late" : ""}`}><strong>{days} {days === 1 ? "dia" : "dias"}</strong><small>desde {formatDate(`${item.problem_started_at}T12:00:00`)}</small></span><span><Badge tone={item.customer_mood === "very_upset" ? "red" : item.customer_mood === "upset" ? "amber" : item.customer_mood === "calm" ? "green" : "neutral"}>{moodEmoji[item.customer_mood]} {moodLabels[item.customer_mood]}</Badge></span><span><Badge tone={item.workflow_stage === "awaiting_internal_action" ? "amber" : item.workflow_stage === "completed" ? "green" : "neutral"}>{stageLabels[item.workflow_stage]}</Badge></span><span><PriorityBadge priority={item.priority} /></span><span className="case-arrow"><ChevronRight size={18} /></span></button>; })}</div>;
}

function CaseDetailsModal({ item, profile, profiles, onClose, onChanged }: { item: NevCase; profile: Profile; profiles: Profile[]; onClose: () => void; onChanged: () => void }) {
  const [updates, setUpdates] = useState<CaseUpdate[]>([]); const [attachments, setAttachments] = useState<CaseAttachment[]>([]); const [caseOrders, setCaseOrders] = useState<CaseOrder[]>([]);
  const [note, setNote] = useState(""); const [recipient, setRecipient] = useState("");
  const [actionRecipient, setActionRecipient] = useState(() => profiles.find((person) => person.active && person.user_id !== profile.user_id && person.is_super_admin)?.user_id || profiles.find((person) => person.active && person.user_id !== profile.user_id)?.user_id || ""); const [actionNote, setActionNote] = useState(""); const [actionMood, setActionMood] = useState<CustomerMood | "">("");
  const [releaseNote, setReleaseNote] = useState(""); const [releaseTo, setReleaseTo] = useState(""); const [releaseOptions, setReleaseOptions] = useState<ResolutionType[]>(item.available_resolutions || []);
  const [files, setFiles] = useState<File[]>([]); const [category, setCategory] = useState<CaseAttachment["category"]>("problem");
  const [resolutionOpen, setResolutionOpen] = useState(item.review_status === "approved" && item.status !== "resolved"); const [resolutionType, setResolutionType] = useState<ResolutionType>(item.available_resolutions?.[0] || "reorder");
  const [resolutionAmount, setResolutionAmount] = useState(String(item.order_value).replace(".", ",")); const [resolutionNotes, setResolutionNotes] = useState(""); const [completionMood, setCompletionMood] = useState<CustomerMood | "">(""); const [pixKey, setPixKey] = useState(item.pix_key || ""); const [installments, setInstallments] = useState("3");
  const [firstDueDate, setFirstDueDate] = useState(() => { const date = new Date(); date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 10); });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const reviewers = profiles.filter((person) => person.active && person.user_id !== profile.user_id);

  const loadDetails = useCallback(async () => {
    const [updateResult, attachmentResult, orderResult] = await Promise.all([
      supabase.from("nev_case_updates").select("*").eq("case_id", item.id).order("created_at", { ascending: false }),
      supabase.from("nev_case_attachments").select("*").eq("case_id", item.id).order("created_at", { ascending: false }),
      supabase.from("nev_case_orders").select("*").eq("case_id", item.id).order("order_date", { ascending: true }),
    ]);
    setUpdates((updateResult.data || []) as CaseUpdate[]); setAttachments((attachmentResult.data || []) as CaseAttachment[]); setCaseOrders((orderResult.data || []) as CaseOrder[]);
  }, [item.id]);
  useEffect(() => { const timer = window.setTimeout(() => void loadDetails(), 0); return () => window.clearTimeout(timer); }, [loadDetails]);

  async function run(action: () => Promise<{ error?: { message: string } | null }>, done = true) {
    setBusy(true); setError(""); const result = await action();
    if (result.error) setError(result.error.message); else { await loadDetails(); if (done) onChanged(); }
    setBusy(false); return !result.error;
  }
  async function addNote(event: FormEvent) { event.preventDefault(); if (!note.trim()) return; const ok = await run(() => supabase.from("nev_case_updates").insert({ case_id: item.id, author_id: profile.user_id, recipient_id: recipient || null, kind: "note", body: note.trim() }), false); if (ok) setNote(""); }
  async function requestAction() { if (!actionRecipient || !actionNote.trim() || !actionMood) { setError("Selecione o humor, o responsável e descreva a ação."); return; } await run(() => supabase.rpc("nev_request_case_action", { p_case_id: item.id, p_recipient_id: actionRecipient, p_customer_mood: actionMood, p_note: actionNote.trim() })); }
  async function release() { if (!releaseTo || !releaseOptions.length) { setError("Escolha as opções e quem continuará com o cliente."); return; } await run(() => supabase.rpc("nev_release_case_options", { p_case_id: item.id, p_options: releaseOptions, p_assign_to: releaseTo, p_note: releaseNote || null })); }
  async function resolve(event: FormEvent) { event.preventDefault(); if (!completionMood) { setError("Selecione o humor final do cliente."); return; } await run(() => supabase.rpc("nev_complete_case_flow", { p_case_id: item.id, p_resolution_type: resolutionType, p_amount: Number(resolutionAmount.replace(",", ".")), p_notes: resolutionNotes || null, p_customer_mood: completionMood, p_pix_key: resolutionType === "installment_refund" ? pixKey.trim() : null, p_installments: resolutionType === "installment_refund" ? Number(installments) : null, p_first_due_date: resolutionType === "installment_refund" ? firstDueDate : null })); }
  async function startContact() { await run(() => supabase.rpc("nev_start_customer_contact", { p_case_id: item.id })); }
  async function waitCustomer() { await run(() => supabase.rpc("nev_wait_customer", { p_case_id: item.id, p_note: "Aguardando resposta do cliente no WhatsApp." })); }
  async function upload() { if (!files.length) return; setBusy(true); setError(""); try { await uploadCaseFiles(item.id, files, category, profile); setFiles([]); await loadDetails(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : "Falha ao anexar."); } setBusy(false); }
  async function openAttachment(attachment: CaseAttachment) { const { data, error: signedError } = await supabase.storage.from("nev-case-files").createSignedUrl(attachment.storage_path, 120); if (signedError) setError(signedError.message); else window.open(data.signedUrl, "_blank", "noopener,noreferrer"); }
  async function renegotiate() { const ok = await run(() => supabase.rpc("nev_begin_renegotiation", { p_case_id: item.id, p_note: "Cliente solicitou mudança da solução." })); if (ok) setResolutionOpen(true); }
  const canRelease = profile.is_super_admin && item.workflow_stage === "awaiting_internal_action";
  const canContact = item.assigned_to === profile.user_id || item.current_action_user === profile.user_id || profile.role === "admin";
  const selectableSolutions = Object.entries(resolutionLabels).filter(([key]) => key !== "store_credit") as [ResolutionType, string][];

  return <Modal title={item.customer_name} eyebrow={`${caseCode(item.case_number)} · ${stageLabels[item.workflow_stage]}`} onClose={onClose} wide><div className="details-layout details-layout--workflow"><div className="details-main">
    <div className="workflow-banner"><div><span>Próxima ação</span><strong>{item.workflow_stage === "awaiting_internal_action" ? `${personName(profiles, item.current_action_user)} precisa analisar` : item.workflow_stage === "options_released" ? `${personName(profiles, item.assigned_to)} deve falar com o cliente` : item.workflow_stage === "waiting_customer" ? "Aguardando resposta do cliente" : item.workflow_stage === "completed" ? "Atendimento finalizado" : "Atendimento com o cliente em andamento"}</strong></div><Badge tone={item.workflow_stage === "awaiting_internal_action" ? "amber" : item.workflow_stage === "completed" ? "green" : "neutral"}>{stageLabels[item.workflow_stage]}</Badge></div>
    <section className="details-summary details-summary--flow"><div><span>Tempo com o problema</span><strong>{daysWithProblem(item.problem_started_at)} dias</strong></div><div><span>Humor atual</span><strong>{moodEmoji[item.customer_mood]} {moodLabels[item.customer_mood]}</strong></div><div><span>Prioridade</span><strong>{priorityLabels[item.priority]}</strong></div><div><span>Total dos pedidos</span><strong>{money.format(Number(item.order_value))}</strong></div><div><span>Responsável</span><strong>{personName(profiles, item.assigned_to)}</strong></div></section>
    <section className="details-block orders-summary"><div className="orders-summary__head"><h3>Pedidos vinculados</h3><Badge tone="green">Total {money.format(Number(item.order_value))}</Badge></div><div>{caseOrders.map((order) => <article className="order-summary-row" key={order.id}><div><strong>{order.system_label}</strong><small>Pedido nº {order.order_number}</small></div><span>{formatDate(`${order.order_date}T12:00:00`)}</span><strong>{money.format(Number(order.amount))}</strong></article>)}{!caseOrders.length && <small>Carregando pedidos...</small>}</div></section>
    <section className="details-block"><h3>Relato do cliente</h3><p>{item.issue_description}</p></section>
    {item.workflow_stage === "in_service" && canContact && item.status !== "resolved" && <section className="details-block action-card"><h3><BellRing size={18} /> Solicitar ação de outro usuário</h3><p>Ao enviar, o humor é obrigatório e o atendimento fica destacado para quem precisa agir.</p><div className="mood-grid mood-grid--compact">{(Object.keys(moodLabels) as CustomerMood[]).map((value) => <button type="button" className={`mood-choice ${actionMood === value ? "is-selected" : ""}`} key={value} onClick={() => setActionMood(value)}><span>{moodEmoji[value]}</span><strong>{moodLabels[value]}</strong></button>)}</div><div className="form-grid"><label className="field"><span>Quem precisa agir?</span><select value={actionRecipient} onChange={(e) => setActionRecipient(e.target.value)}><option value="">Selecione</option>{reviewers.map((person) => <option key={person.user_id} value={person.user_id}>{person.is_super_admin ? "Clovis · administrador geral" : person.full_name || person.email}</option>)}</select></label><label className="field field--wide"><span>Qual ação precisa ser feita?</span><textarea value={actionNote} onChange={(e) => setActionNote(e.target.value)} rows={3} placeholder="Ex.: analisar chargeback e liberar soluções." /></label><button type="button" className="button button--primary field--wide" onClick={requestAction} disabled={busy || !actionMood}><Send size={17} /> Solicitar ação</button></div><button type="button" className="button button--ghost button--full" onClick={waitCustomer} disabled={busy}>Aguardando resposta do cliente</button></section>}
    {canRelease && <section className="details-block action-card action-card--attention"><h3><ShieldCheck size={18} /> Clovis: libere as opções de conclusão</h3><p>Escolha tudo que poderá ser apresentado ao cliente e indique obrigatoriamente quem receberá a próxima ação.</p><div className="solution-options">{selectableSolutions.map(([key, label]) => <label key={key} className={releaseOptions.includes(key) ? "is-selected" : ""}><input type="checkbox" checked={releaseOptions.includes(key)} onChange={(e) => setReleaseOptions((current) => e.target.checked ? [...current, key] : current.filter((value) => value !== key))} /><span>{label}</span></label>)}</div><div className="form-grid"><label className="field"><span>Enviar a próxima ação para</span><select value={releaseTo} onChange={(e) => setReleaseTo(e.target.value)} required><option value="">Escolha o usuário</option>{profiles.filter((person) => person.active && person.user_id !== profile.user_id).map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name || person.email}</option>)}</select><small>Somente a pessoa escolhida será notificada.</small></label><label className="field field--wide"><span>Orientação para quem receber</span><textarea value={releaseNote} onChange={(e) => setReleaseNote(e.target.value)} rows={3} placeholder="Ex.: apresente as opções e confirme qual o cliente escolheu." /></label><button type="button" className="button button--success field--wide" onClick={release} disabled={busy || !releaseOptions.length || !releaseTo}><CheckCircle2 size={17} /> Liberar e enviar a ação</button></div></section>}
    {item.workflow_stage === "options_released" && canContact && <section className="details-block action-card action-card--approved"><h3><MessageCircle size={18} /> Opções liberadas por Clovis</h3><p>Entre em contato com o cliente e apresente somente estas opções:</p><div className="released-options">{item.available_resolutions.map((type) => <Badge tone="green" key={type}>{resolutionLabels[type]}</Badge>)}</div><button type="button" className="button button--primary" onClick={startContact} disabled={busy}><PlayCircle size={17} /> Iniciar atendimento com o cliente</button></section>}
    {item.workflow_stage === "waiting_customer" && canContact && <section className="details-block action-card"><h3><Clock3 size={18} /> Aguardando o cliente</h3><p>Quando ele responder no WhatsApp, retome a conversa por aqui.</p><button type="button" className="button button--primary" onClick={startContact} disabled={busy}><PlayCircle size={17} /> Cliente respondeu: iniciar atendimento</button></section>}
    {item.workflow_stage === "in_service" && item.available_resolutions.length > 0 && canContact && item.status !== "resolved" && <section className="details-block action-card action-card--approved"><h3><CheckCircle2 size={18} /> Concluir atendimento</h3>{!resolutionOpen ? <button className="button button--success" onClick={() => setResolutionOpen(true)}>Registrar escolha do cliente</button> : <form className="form-grid" onSubmit={resolve}><label className="field"><span>Solução escolhida</span><select value={resolutionType} onChange={(e) => setResolutionType(e.target.value as ResolutionType)}>{item.available_resolutions.map((key) => <option value={key} key={key}>{resolutionLabels[key]}</option>)}</select></label><label className="field"><span>Valor</span><input inputMode="decimal" value={resolutionAmount} onChange={(e) => setResolutionAmount(e.target.value)} required /></label>{resolutionType === "installment_refund" && <><label className="field"><span>Chave PIX do cliente</span><input value={pixKey} onChange={(e) => setPixKey(e.target.value)} placeholder="CPF, telefone, e-mail ou chave aleatória" required /></label><label className="field"><span>Parcelas (1 a 36)</span><input type="number" min={1} max={36} value={installments} onChange={(e) => setInstallments(e.target.value)} /></label><label className="field"><span>Primeiro vencimento</span><input type="date" value={firstDueDate} onChange={(e) => setFirstDueDate(e.target.value)} /></label></>}<div className="field field--wide"><span>Humor final do cliente</span><div className="mood-grid mood-grid--compact">{(Object.keys(moodLabels) as CustomerMood[]).map((value) => <button type="button" className={`mood-choice ${completionMood === value ? "is-selected" : ""}`} key={value} onClick={() => setCompletionMood(value)}><span>{moodEmoji[value]}</span><strong>{moodLabels[value]}</strong></button>)}</div></div><label className="field field--wide"><span>Observações finais</span><textarea value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} rows={3} /></label><button className="button button--success field--wide" disabled={busy || !completionMood}><CheckCircle2 size={17} /> Finalizar atendimento geral</button></form>}</section>}
    {item.status === "resolved" && <section className="details-block resolved-card"><h3><CheckCircle2 size={18} /> Solução atual</h3><strong>{item.resolution_type ? resolutionLabels[item.resolution_type] : "Resolvido"} · {money.format(Number(item.resolution_amount || 0))}</strong><p>{item.resolution_notes || "Sem observação."}</p>{item.pix_key && <div className="pix-box"><div><span>Chave PIX para o reembolso</span><strong>{item.pix_key}</strong></div><button type="button" className="button button--ghost" onClick={() => navigator.clipboard.writeText(item.pix_key || "")}><Copy size={16} /> Copiar PIX</button></div>}<button className="button button--ghost" onClick={renegotiate}><RefreshCw size={17} /> Renegociar solução</button></section>}
    <section className="details-block"><h3><MessageCircle size={18} /> Histórico e observações</h3><form className="note-form" onSubmit={addNote}><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escreva uma observação..." rows={2} /><select value={recipient} onChange={(e) => setRecipient(e.target.value)}><option value="">Sem destinatário</option>{profiles.filter((p) => p.active && p.user_id !== profile.user_id).map((p) => <option value={p.user_id} key={p.user_id}>Enviar para {p.full_name || p.email}</option>)}</select><button className="button button--primary" disabled={busy}><Send size={16} /> Salvar</button></form><div className="timeline">{updates.map((update) => <article key={update.id}><span className={`timeline-dot timeline-dot--${update.kind}`} /><div><div><strong>{personName(profiles, update.author_id)}</strong><time>{formatDateTime(update.created_at)}</time></div><p>{update.body}</p>{update.recipient_id && <small>Enviado para {personName(profiles, update.recipient_id)}</small>}</div></article>)}</div></section>
  </div><aside className="details-aside"><a className="whatsapp-button" href={whatsappUrl(item.whatsapp)} target="_blank" rel="noreferrer"><MessageCircle size={18} /> Abrir WhatsApp</a><div className="aside-section"><span className="aside-label">Anexos do atendimento</span><div className="attachment-list">{attachments.map((attachment) => <button key={attachment.id} onClick={() => openAttachment(attachment)}><FileImage size={18} /><span><strong>{attachmentLabels[attachment.category]}</strong><small>{attachment.original_name} · {formatDateTime(attachment.created_at)}</small></span></button>)}{!attachments.length && <small>Nenhum anexo ainda.</small>}</div></div><div className="aside-section"><label className="field"><span>Tipo do arquivo</span><select value={category} onChange={(e) => setCategory(e.target.value as CaseAttachment["category"])}>{Object.entries(attachmentLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field file-field"><span>Adicionar quando quiser</span><input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label><button className="button button--primary button--full" onClick={upload} disabled={busy || !files.length}><Paperclip size={16} /> Anexar {files.length || "arquivo"}</button></div>{error && <div className="form-message form-message--error">{error}</div>}</aside></div></Modal>;
}

function NewTaskModal({ profile, profiles, onClose, onCreated }: { profile: Profile; profiles: Profile[]; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [priority, setPriority] = useState<Priority>("normal"); const [assigned, setAssigned] = useState(profile.user_id); const [remindAt, setRemindAt] = useState(""); const [due, setDue] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: taskError } = await supabase.rpc("nev_create_scheduled_task", { p_title: title.trim(), p_description: description.trim(), p_priority: priority, p_assigned_to: assigned, p_due_at: due ? new Date(due).toISOString() : null, p_remind_at: remindAt ? new Date(remindAt).toISOString() : null }); if (taskError) setError(taskError.message); else onCreated(); setBusy(false); }
  return <Modal title="Nova tarefa" eyebrow="AÇÃO INTERNA" onClose={onClose}><form className="modal__body form-stack" onSubmit={submit}><label className="field"><span>O que precisa ser feito?</span><input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></label><label className="field"><span>Detalhes</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></label><div className="form-grid"><label className="field"><span>Responsável</span><select value={assigned} onChange={(e) => setAssigned(e.target.value)}>{profiles.filter((p) => p.active).map((p) => <option key={p.user_id} value={p.user_id}>{p.user_id === profile.user_id ? `Eu mesmo — ${p.full_name || p.email}` : p.full_name || p.email}</option>)}</select></label><label className="field"><span>Prioridade</span><select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>{Object.entries(priorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="field"><span>Alertar no dia e hora</span><input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} /></label><label className="field"><span>Prazo para entregar pronta</span><input type="datetime-local" value={due} min={remindAt || undefined} onChange={(e) => setDue(e.target.value)} /></label></div><div className="form-message form-message--info"><BellRing size={16} /> A tarefa aparecerá em <strong>Aguardando sua ação</strong> quando chegar o horário do alerta. Se passar do prazo, ficará marcada como atrasada.</div>{error && <div className="form-message form-message--error">{error}</div>}<footer className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button><button className="button button--primary" disabled={busy}>{busy ? <Loader2 className="spin" size={17} /> : <Send size={17} />} {assigned === profile.user_id ? "Programar tarefa" : "Enviar tarefa"}</button></footer></form></Modal>;
}

function TaskDetailsModal({ task, profile, profiles, onClose, onChanged }: { task: NevTask; profile: Profile; profiles: Profile[]; onClose: () => void; onChanged: () => void }) {
  const [updates, setUpdates] = useState<TaskUpdate[]>([]); const [text, setText] = useState(""); const [snoozeAt, setSnoozeAt] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { const { data } = await supabase.from("nev_task_updates").select("*").eq("task_id", task.id).order("created_at", { ascending: false }); setUpdates((data || []) as TaskUpdate[]); }, [task.id]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function call(name: string, args: Record<string, unknown>) { setBusy(true); setError(""); const { error: rpcError } = await supabase.rpc(name, args); if (rpcError) setError(rpcError.message); else { await load(); onChanged(); } setBusy(false); }
  const assignedToMe = task.assigned_to === profile.user_id; const creatorWaiting = task.status === "awaiting_creator" && task.created_by === profile.user_id;
  return <Modal title={task.title} eyebrow="TAREFA" onClose={onClose}><div className="modal__body form-stack"><div className="task-detail-head"><PriorityBadge priority={task.priority} /><Badge tone={task.status === "done" ? "green" : creatorWaiting || assignedToMe ? "amber" : "neutral"}>{task.status === "done" ? "Concluída" : task.status === "awaiting_creator" ? "Aguardando resposta" : "Em aberto"}</Badge></div><p className="task-description">{task.description || "Sem detalhes adicionais."}</p><div className="task-meta"><span>Responsável <strong>{personName(profiles, task.assigned_to)}</strong></span>{task.remind_at && <span>Alerta <strong>{formatDateTime(task.remind_at)}</strong></span>}<span>Prazo <strong>{task.due_at ? formatDateTime(task.due_at) : "Sem prazo"}</strong></span></div>
    {task.status !== "done" && assignedToMe && <section className="task-action-box"><h3>Minha ação</h3><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite uma pergunta para quem criou..." rows={2} /><div className="split-actions"><button className="button button--ghost" disabled={!text.trim() || busy} onClick={() => call("nev_task_send_question", { p_task_id: task.id, p_body: text.trim() })}><MessageCircle size={16} /> Enviar pergunta</button><button className="button button--success" disabled={busy} onClick={() => call("nev_task_complete", { p_task_id: task.id })}><Check size={16} /> Marcar como feita</button></div></section>}
    {creatorWaiting && <section className="task-action-box action-card--attention"><h3>Responder para o responsável continuar</h3><textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} /><button className="button button--primary" disabled={!text.trim() || busy} onClick={() => call("nev_task_answer", { p_task_id: task.id, p_body: text.trim() })}><Send size={16} /> Responder e devolver</button></section>}
    {task.status !== "done" && assignedToMe && <section className="task-action-box"><h3><PauseCircle size={17} /> Adiar tarefa</h3><input type="datetime-local" value={snoozeAt} onChange={(e) => setSnoozeAt(e.target.value)} /><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo obrigatório" rows={2} /><button className="button button--ghost" disabled={!snoozeAt || !reason.trim() || busy} onClick={() => call("nev_task_snooze", { p_task_id: task.id, p_until: new Date(snoozeAt).toISOString(), p_reason: reason.trim() })}>Adiar até esta data</button></section>}
    {error && <div className="form-message form-message--error">{error}</div>}<div className="timeline compact-timeline">{updates.map((update) => <article key={update.id}><span className="timeline-dot" /><div><div><strong>{personName(profiles, update.author_id)}</strong><time>{formatDateTime(update.created_at)}</time></div><p>{update.body}</p></div></article>)}</div></div></Modal>;
}

function PaymentModal({ entry, onClose, onPaid }: { entry: RefundInstallment; onClose: () => void; onPaid: () => void }) {
  const paymentPix = entry.pix_key || (entry as RefundInstallment & { plan?: RefundPlan }).plan?.pix_key; const remaining = Number(entry.amount) - Number(entry.paid_amount || 0); const [amount, setAmount] = useState(String(remaining).replace(".", ",")); const [notes, setNotes] = useState(""); const [newDue, setNewDue] = useState(""); const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const partial = Number(amount.replace(",", ".")) < remaining;
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const { error: paymentError } = await supabase.rpc("nev_record_installment_payment", { p_installment_id: entry.id, p_amount: Number(amount.replace(",", ".")), p_notes: notes || null, p_new_due_date: partial && newDue ? newDue : null, p_delay_reason: partial && newDue ? reason : null }); if (paymentError) setError(paymentError.message); else onPaid(); setBusy(false); }
  return <Modal title="Registrar pagamento" eyebrow={`PARCELA ${entry.installment_number}`} onClose={onClose}><form className="modal__body form-stack" onSubmit={submit}><div className="payment-balance"><span>Saldo desta parcela</span><strong>{money.format(remaining)}</strong></div>{paymentPix && <div className="pix-box"><div><span>Chave PIX do cliente</span><strong>{paymentPix}</strong></div><button type="button" className="button button--ghost" onClick={() => navigator.clipboard.writeText(paymentPix)}><Copy size={16} /> Copiar PIX</button></div>}<label className="field"><span>Valor pago agora</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>{partial && <><div className="form-message form-message--info">Será registrado pagamento parcial. O restante continuará pendente.</div><label className="field"><span>Adiar restante para</span><input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></label>{newDue && <label className="field"><span>Motivo do adiamento</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required /></label>}</>}<label className="field"><span>Observação</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></label>{error && <div className="form-message form-message--error">{error}</div>}<button className="button button--success button--full" disabled={busy}>{busy && <Loader2 className="spin" size={17} />}{partial ? "Salvar pagamento parcial" : "Marcar como pago integral"}</button></form></Modal>;
}

function DashboardView({ cases, tasks, refunds, myAction, onTab, onNewCase }: { cases: NevCase[]; tasks: NevTask[]; refunds: RefundPlan[]; myAction: number; onTab: (tab: Tab) => void; onNewCase: () => void }) {
  const active = cases.filter((item) => !["resolved", "cancelled"].includes(item.status)); const pending = refunds.flatMap((p) => p.nev_refund_installments).filter((i) => ["pending", "partial"].includes(i.status)); const today = new Date().toISOString(); const lateTasks = tasks.filter((t) => t.status !== "done" && t.due_at && t.due_at < today).length;
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">RESUMO OPERACIONAL</span><h1>Visão geral</h1><p>Veja o que precisa andar hoje.</p></div><button className="button button--primary" onClick={onNewCase}><Plus size={18} /> Novo atendimento</button></section><section className="stats-grid"><StatCard label="Aguardando sua ação" value={myAction} detail="itens que dependem de você" icon={<BellRing size={21} />} tone="amber" /><StatCard label="Atendimentos ativos" value={active.length} detail={`${cases.filter((c) => c.review_status === "pending").length} em conferência`} icon={<Headphones size={21} />} tone="blue" /><StatCard label="Tarefas atrasadas" value={lateTasks} detail="prazo já vencido" icon={<CalendarClock size={21} />} tone="violet" /><StatCard label="Reembolsos pendentes" value={money.format(pending.reduce((sum, i) => sum + Number(i.amount) - Number(i.paid_amount || 0), 0))} detail={`${pending.length} parcelas`} icon={<WalletCards size={21} />} tone="green" /></section><section className="dashboard-grid"><article className="panel action-spotlight"><span className="eyebrow">PRIORIDADE</span><h2>Aguardando sua ação</h2><p>Conferências, respostas e tarefas que não podem seguir sem você.</p><button className="button button--dark" onClick={() => onTab("action")}>Abrir minha fila <ChevronRight size={17} /></button></article><article className="panel"><div className="panel__header"><div><span className="eyebrow">ATENDIMENTOS</span><h2>Últimos registros</h2></div><button className="link-button" onClick={() => onTab("cases")}>Ver todos</button></div><div className="simple-list">{cases.slice(0, 5).map((item) => <button key={item.id} onClick={() => onTab("cases")}><span>{caseCode(item.case_number)}</span><strong>{item.customer_name}</strong><Badge tone={item.review_status === "approved" ? "green" : "amber"}>{reviewLabels[item.review_status]}</Badge></button>)}</div></article></section></div>;
}

function CasesView({ cases, onOpen, onNew }: { cases: NevCase[]; onOpen: (item: NevCase) => void; onNew: () => void }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState("active"); const filtered = cases.filter((item) => (!search || `${item.customer_name} ${item.whatsapp} ${caseCode(item.case_number)}`.toLowerCase().includes(search.toLowerCase())) && (filter === "all" || filter === "active" && !["resolved", "cancelled"].includes(item.status) || item.review_status === filter || item.status === filter));
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">CENTRAL DE PENDÊNCIAS</span><h1>Atendimentos</h1><p>Documente, envie para conferência e resolva.</p></div><button className="button button--primary" onClick={onNew}><Plus size={18} /> Novo atendimento</button></section><section className="panel cases-panel"><div className="filters"><label className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, WhatsApp ou protocolo" /></label><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="active">Pendentes</option><option value="all">Todos</option><option value="pending">Aguardando conferência</option><option value="changes_requested">Com ajustes</option><option value="approved">Liberados</option><option value="resolved">Resolvidos</option></select></div><CaseList cases={filtered} onOpen={onOpen} /></section></div>;
}

function ActionView({ cases, tasks, profile, onCase, onTask }: { cases: NevCase[]; tasks: NevTask[]; profile: Profile; onCase: (item: NevCase) => void; onTask: (task: NevTask) => void }) {
  const now = new Date().toISOString(); const caseActions = cases.filter((item) => item.current_action_user === profile.user_id && !["resolved", "cancelled"].includes(item.status)); const taskActions = tasks.filter((task) => task.waiting_on === profile.user_id && task.status !== "done" && (!task.remind_at || task.remind_at <= now) && (!task.snoozed_until || task.snoozed_until <= now));
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">SUA FILA PRIORITÁRIA</span><h1>Aguardando sua ação</h1><p>Somente o que depende de você agora.</p></div></section><section className="panel"><div className="panel__header"><h2>Atendimentos ({caseActions.length})</h2></div><CaseList cases={caseActions} onOpen={onCase} /></section><section className="panel"><div className="panel__header"><h2>Tarefas ({taskActions.length})</h2></div><TaskList tasks={taskActions} profiles={[]} onOpen={onTask} /></section></div>;
}

function TaskList({ tasks, profiles, onOpen }: { tasks: NevTask[]; profiles: Profile[]; onOpen: (task: NevTask) => void }) {
  if (!tasks.length) return <EmptyState icon={<ClipboardCheck size={24} />} title="Nada aguardando" text="As tarefas aparecem aqui quando alguém precisa agir." />;
  const now = new Date().toISOString(); return <div className="task-list">{tasks.map((task) => { const late = task.status !== "done" && !!task.due_at && task.due_at < now; return <button className={`task-row ${late ? "task-row--late" : ""}`} key={task.id} onClick={() => onOpen(task)}><span className="task-check">{task.status === "done" ? <Check size={17} /> : <ClipboardList size={17} />}</span><div><strong>{task.title}</strong><small>{profiles.length ? personName(profiles, task.assigned_to) : "Sua ação"}{task.remind_at ? ` · Alerta ${formatDateTime(task.remind_at)}` : ""}{task.due_at ? ` · Prazo ${formatDateTime(task.due_at)}` : " · Sem prazo"}</small></div><PriorityBadge priority={task.priority} />{late && <Badge tone="red">Atrasada</Badge>}<ChevronRight size={18} /></button>; })}</div>;
}

function TasksView({ tasks, profiles, onOpen, onNew }: { tasks: NevTask[]; profiles: Profile[]; onOpen: (task: NevTask) => void; onNew: () => void }) {
  const [filter, setFilter] = useState("open"); const filtered = tasks.filter((task) => filter === "all" ? true : filter === "done" ? task.status === "done" : task.status !== "done");
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">TRABALHO INTERNO</span><h1>Tarefas da equipe</h1><p>Responsável, prioridade, prazo, perguntas e conclusão.</p></div><button className="button button--primary" onClick={onNew}><Plus size={18} /> Nova tarefa</button></section><section className="panel"><div className="filters"><select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="open">Em aberto</option><option value="done">Concluídas</option><option value="all">Todas</option></select></div><TaskList tasks={filtered} profiles={profiles} onOpen={onOpen} /></section></div>;
}

function RefundsView({ plans, onPay }: { plans: RefundPlan[]; onPay: (entry: RefundInstallment) => void }) {
  const rows = plans.flatMap((plan) => plan.nev_refund_installments.map((entry) => ({ ...entry, plan }))).filter((entry) => entry.status !== "cancelled").sort((a, b) => a.due_date.localeCompare(b.due_date)); const today = new Date().toISOString().slice(0, 10);
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">AGENDA FINANCEIRA</span><h1>Parcelas de reembolso</h1><p>Registre pagamentos integrais ou parciais e adie somente o saldo.</p></div></section><section className="panel refunds-panel">{rows.length ? <div className="refund-list">{rows.map((entry) => { const remaining = Number(entry.amount) - Number(entry.paid_amount || 0); const late = ["pending", "partial"].includes(entry.status) && entry.due_date < today; return <article className="refund-row" key={entry.id}><span className={`date-tile ${late ? "date-tile--late" : entry.status === "paid" ? "date-tile--paid" : ""}`}><strong>{new Date(`${entry.due_date}T12:00:00`).getDate()}</strong><small>{new Date(`${entry.due_date}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span><div className="refund-customer"><strong>{entry.plan.nev_cases?.customer_name || "Cliente"}</strong><small>{caseCode(entry.plan.nev_cases?.case_number || 0)} · Parcela {entry.installment_number}/{entry.plan.installment_count}</small></div><div className="refund-due"><span>Pago / total</span><strong>{money.format(Number(entry.paid_amount || 0))} / {money.format(Number(entry.amount))}</strong></div><strong className="refund-amount">Saldo {money.format(remaining)}</strong><div className="refund-status">{entry.status === "paid" ? <Badge tone="green">Pago</Badge> : entry.status === "partial" ? <Badge tone="amber">Parcial</Badge> : late ? <Badge tone="red">Atrasado</Badge> : <Badge>Pendente</Badge>}</div>{entry.status !== "paid" && <button className="button button--success" onClick={() => onPay(entry)}><CircleDollarSign size={16} /> Registrar pagamento</button>}</article>; })}</div> : <EmptyState icon={<HandCoins size={24} />} title="Nenhuma parcela" text="Parcelas surgirão após uma solução de reembolso." />}</section></div>;
}

function AuditView({ events, profiles }: { events: AuditEvent[]; profiles: Profile[] }) {
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">VISÍVEL SOMENTE PARA CLOVIS</span><h1>Histórico de acessos e ações</h1><p>Data, hora, usuário e tudo que foi alterado no sistema.</p></div></section><section className="panel audit-panel"><div className="audit-list">{events.map((event) => <article key={event.id}><span className="audit-icon">{event.entity_type === "access" ? <UserCheck size={17} /> : <History size={17} />}</span><div><strong>{event.entity_type === "access" ? "Acesso ao sistema" : `${event.action.toUpperCase()} em ${event.entity_type.replace("nev_", "")}`}</strong><small>{personName(profiles, event.actor_id)} · {formatDateTime(event.created_at)}</small></div><code>{event.entity_id || "—"}</code></article>)}</div></section></div>;
}

function TeamView({ profile, profiles, onChanged }: { profile: Profile; profiles: Profile[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); async function change(person: Profile, active: boolean, role: UserRole) { setBusy(person.user_id); setError(""); const { error: updateError } = await supabase.rpc("nev_admin_set_profile", { p_user_id: person.user_id, p_active: active, p_role: role }); if (updateError) setError(updateError.message); else onChanged(); setBusy(""); }
  return <div className="view-stack"><section className="hero-row"><div><span className="eyebrow">ACESSOS E PERMISSÕES</span><h1>Equipe</h1><p>Aprove usuários e defina administradores.</p></div></section><section className="panel team-panel">{error && <div className="form-message form-message--error">{error}</div>}<div className="team-list">{profiles.map((person) => <article className="team-row" key={person.user_id}><span className="avatar">{(person.full_name || person.email)[0].toUpperCase()}</span><div className="team-person"><strong>{person.full_name || "Nome não informado"}{person.user_id === profile.user_id && <em>Você</em>}</strong><small>{person.email}</small></div><Badge tone={person.active ? "green" : "amber"}>{person.active ? "Ativo" : "Aguardando"}</Badge><select value={person.role} disabled={profile.role !== "admin" || busy === person.user_id} onChange={(e) => change(person, person.active, e.target.value as UserRole)}><option value="agent">Atendente</option><option value="admin">Administrador</option></select>{profile.role === "admin" && (person.active ? <button className="button button--ghost" onClick={() => change(person, false, person.role)} disabled={busy === person.user_id}><UserX size={16} /> Desativar</button> : <button className="button button--success" onClick={() => change(person, true, person.role)} disabled={busy === person.user_id}><UserCheck size={16} /> Aprovar</button>)}</article>)}</div></section></div>;
}

function Workspace({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("dashboard"); const [cases, setCases] = useState<NevCase[]>([]); const [profiles, setProfiles] = useState<Profile[]>([]); const [customers, setCustomers] = useState<NevCustomer[]>([]); const [orderSystems, setOrderSystems] = useState<OrderSystem[]>([]); const [refunds, setRefunds] = useState<RefundPlan[]>([]); const [tasks, setTasks] = useState<NevTask[]>([]); const [audits, setAudits] = useState<AuditEvent[]>([]); const [dismissedTutorials, setDismissedTutorials] = useState<Set<string>>(new Set()); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [newCase, setNewCase] = useState(false); const [newTask, setNewTask] = useState(false); const [selectedCase, setSelectedCase] = useState<NevCase | null>(null); const [selectedTask, setSelectedTask] = useState<NevTask | null>(null); const [payment, setPayment] = useState<RefundInstallment | null>(null); const [toast, setToast] = useState("");
  const loadAll = useCallback(async () => {
    const requests = [supabase.from("nev_cases").select("*").order("last_activity_at", { ascending: false }), supabase.from("nev_profiles").select("*").order("created_at"), supabase.from("nev_customers").select("*").order("created_at", { ascending: false }), supabase.from("nev_order_systems").select("*").eq("active", true).order("sort_order"), supabase.from("nev_refund_plans").select("*, nev_cases(id,case_number,customer_name,whatsapp), nev_refund_installments(*)").order("created_at", { ascending: false }), supabase.from("nev_tasks").select("*").order("updated_at", { ascending: false }), supabase.from("nev_tutorial_dismissals").select("tutorial_key")];
    const [caseR, profileR, customerR, systemR, refundR, taskR, tutorialR] = await Promise.all(requests); const firstError = caseR.error || profileR.error || customerR.error || systemR.error || refundR.error || taskR.error || tutorialR.error;
    if (firstError) setError(firstError.message); else { setError(""); setCases((caseR.data || []) as NevCase[]); setProfiles((profileR.data || []) as Profile[]); setCustomers((customerR.data || []) as NevCustomer[]); setOrderSystems((systemR.data || []) as OrderSystem[]); setRefunds((refundR.data || []) as unknown as RefundPlan[]); setTasks((taskR.data || []) as NevTask[]); setDismissedTutorials(new Set((tutorialR.data || []).map((row) => row.tutorial_key))); }
    if (profile.is_super_admin) { const { data } = await supabase.from("nev_audit_events").select("*").order("created_at", { ascending: false }).limit(500); setAudits((data || []) as AuditEvent[]); }
    setLoading(false);
  }, [profile.is_super_admin]);
  useEffect(() => { const timer = window.setTimeout(() => { void supabase.rpc("nev_log_access", { p_action: "login" }); void loadAll(); }, 0); const reminderTimer = window.setInterval(() => void loadAll(), 60000); const channel = supabase.channel(`nev-live-${profile.user_id}`).on("postgres_changes", { event: "*", schema: "public", table: "nev_cases" }, () => void loadAll()).on("postgres_changes", { event: "*", schema: "public", table: "nev_tasks" }, () => void loadAll()).on("postgres_changes", { event: "*", schema: "public", table: "nev_case_updates" }, () => void loadAll()).on("postgres_changes", { event: "*", schema: "public", table: "nev_refund_installments" }, () => void loadAll()).subscribe(); return () => { window.clearTimeout(timer); window.clearInterval(reminderTimer); void supabase.removeChannel(channel); }; }, [loadAll, profile.user_id]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3200); return () => clearTimeout(timer); }, [toast]);
  function changed(message = "Atualizado com sucesso.") { setSelectedCase(null); setSelectedTask(null); setPayment(null); void loadAll(); setToast(message); }
  async function dismissTutorial(key: string) { const { error: dismissError } = await supabase.rpc("nev_dismiss_tutorial", { p_tutorial_key: key }); if (dismissError) setError(dismissError.message); else setDismissedTutorials((current) => new Set([...current, key])); }
  const now = new Date().toISOString(); const actionCases = cases.filter((c) => c.current_action_user === profile.user_id && !["resolved", "cancelled"].includes(c.status)).length; const actionTasks = tasks.filter((t) => t.waiting_on === profile.user_id && t.status !== "done" && (!t.remind_at || t.remind_at <= now) && (!t.snoozed_until || t.snoozed_until <= now)).length; const myAction = actionCases + actionTasks;
  const nav = [{ id: "dashboard" as Tab, label: "Visão geral", icon: LayoutDashboard }, { id: "action" as Tab, label: "Aguardando sua ação", icon: BellRing }, { id: "cases" as Tab, label: "Atendimentos", icon: Headphones }, { id: "tasks" as Tab, label: "Tarefas", icon: ClipboardCheck }, { id: "refunds" as Tab, label: "Reembolsos", icon: HandCoins }, ...(profile.is_super_admin ? [{ id: "audit" as Tab, label: "Histórico", icon: History }] : []), { id: "team" as Tab, label: "Equipe", icon: UsersRound }];
  return <div className="app-shell"><aside className="sidebar"><Brand inverse /><nav className="sidebar__nav"><span className="nav-label">MENU</span>{nav.map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}><Icon size={19} /><span>{item.label}</span>{item.id === "action" && myAction > 0 && <b className="nav-alert">{myAction}</b>}</button>; })}</nav><div className="sidebar__footer"><div className="sidebar-user"><span>{(profile.full_name || profile.email)[0].toUpperCase()}</span><div><strong>{profile.full_name || "Atendente"}</strong><small>{profile.is_super_admin ? "Administrador geral" : profile.role === "admin" ? "Administrador" : "Atendente"}</small></div></div><button className="sidebar-signout" onClick={onSignOut}><LogOut size={18} /></button></div></aside>
    <main className="workspace"><header className="topbar"><div className="topbar-mobile-brand"><Brand /></div><div className="topbar__date"><CalendarDays size={17} /> {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div><div className="topbar__actions"><button className="icon-button notification-button" onClick={() => setTab("action")}><BellRing size={18} />{myAction > 0 && <i>{myAction}</i>}</button><button className="icon-button" onClick={() => { setLoading(true); void loadAll(); }}><RefreshCw size={18} className={loading ? "spin" : ""} /></button></div></header><div className="workspace__content">{error && <div className="form-message form-message--error">{error}</div>}{loading && !cases.length ? <div className="content-loader"><Loader2 className="spin" size={24} /> Preparando painel...</div> : <>{tab === "dashboard" && <DashboardView cases={cases} tasks={tasks} refunds={refunds} myAction={myAction} onTab={setTab} onNewCase={() => setNewCase(true)} />}{tab === "action" && <ActionView cases={cases} tasks={tasks} profile={profile} onCase={setSelectedCase} onTask={setSelectedTask} />}{tab === "cases" && <CasesView cases={cases} onOpen={setSelectedCase} onNew={() => setNewCase(true)} />}{tab === "tasks" && <TasksView tasks={tasks} profiles={profiles} onOpen={setSelectedTask} onNew={() => setNewTask(true)} />}{tab === "refunds" && <RefundsView plans={refunds} onPay={setPayment} />}{tab === "audit" && profile.is_super_admin && <AuditView events={audits} profiles={profiles} />}{tab === "team" && <TeamView profile={profile} profiles={profiles} onChanged={() => changed("Equipe atualizada.")} />}</>}</div></main>
    <nav className="mobile-nav">{nav.filter((item) => ["dashboard", "action", "cases", "tasks", "refunds"].includes(item.id)).map((item) => { const Icon = item.icon; return <button key={item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}><Icon size={20} /><span>{item.id === "dashboard" ? "Início" : item.id === "action" ? "Minha ação" : item.label}</span>{item.id === "action" && myAction > 0 && <i>{myAction}</i>}</button>; })}</nav>
    {tab === "cases" && <TutorialCard tutorialKey="case_flow" dismissed={dismissedTutorials} title="Fluxo Jean → Clovis → Jean" onDismiss={dismissTutorial}>Jean registra tudo e solicita sua ação. Clovis libera as opções, e o atendimento volta destacado para Jean falar com o cliente.</TutorialCard>}
    {tab === "action" && <TutorialCard tutorialKey="action_queue" dismissed={dismissedTutorials} title="Esta é sua fila de ação" onDismiss={dismissTutorial}>Aqui aparece somente o que depende de você agora. Abra o item para ver exatamente o que precisa fazer.</TutorialCard>}
    {tab === "tasks" && <TutorialCard tutorialKey="personal_tasks" dismissed={dismissedTutorials} title="Tarefas para você ou para a equipe" onDismiss={dismissTutorial}>Crie uma tarefa para si mesmo ou para outra pessoa, defina data e hora e acompanhe alertas de atraso.</TutorialCard>}
    {newCase && <NewCaseModal profile={profile} profiles={profiles} customers={customers} orderSystems={orderSystems} openCount={cases.filter((item) => !["resolved", "cancelled"].includes(item.status)).length} onClose={() => setNewCase(false)} onCreated={() => { setNewCase(false); changed("Atendimento criado com sucesso."); }} />}{newTask && <NewTaskModal profile={profile} profiles={profiles} onClose={() => setNewTask(false)} onCreated={() => { setNewTask(false); changed("Tarefa enviada."); }} />}{selectedCase && <CaseDetailsModal item={selectedCase} profile={profile} profiles={profiles} onClose={() => setSelectedCase(null)} onChanged={() => changed("Atendimento atualizado.")} />}{selectedTask && <TaskDetailsModal task={selectedTask} profile={profile} profiles={profiles} onClose={() => setSelectedTask(null)} onChanged={() => changed("Tarefa atualizada.")} />}{payment && <PaymentModal entry={payment} onClose={() => setPayment(null)} onPaid={() => changed("Pagamento registrado.")} />}{toast && <div className="toast"><CheckCircle2 size={18} /> {toast}</div>}
  </div>;
}

function AuthenticatedRoot({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null); const [loading, setLoading] = useState(true); const [bootstrap, setBootstrap] = useState(false); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); const { error: claimError } = await supabase.rpc("nev_claim_access"); if (claimError?.message.includes("Chave inicial")) { setBootstrap(true); setLoading(false); return; } if (claimError) { setError(claimError.message); setLoading(false); return; } const { data, error: profileError } = await supabase.from("nev_profiles").select("*").eq("user_id", session.user.id).single(); if (profileError) setError(profileError.message); else { setProfile(data as Profile); setError(""); setBootstrap(false); } setLoading(false); }, [session.user.id]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]); async function signOut() { await supabase.auth.signOut(); }
  if (loading) return <CenteredLoader label="Verificando acesso..." />; if (error) return <main className="centered-screen"><Brand /><div className="form-message form-message--error">{error}</div><button className="button button--primary" onClick={load}>Tentar novamente</button></main>; if (bootstrap) return <AccessState bootstrap onReload={load} onSignOut={signOut} />; if (!profile) return <CenteredLoader />; if (!profile.active) return <AccessState profile={profile} onReload={load} onSignOut={signOut} />; return <Workspace profile={profile} onSignOut={signOut} />;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); }); const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false); }); return () => data.subscription.unsubscribe(); }, []);
  if (loading) return <CenteredLoader />; return session ? <AuthenticatedRoot session={session} /> : <AuthScreen />;
}
