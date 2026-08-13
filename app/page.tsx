"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  HandCoins,
  Headphones,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MessageCircle,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UsersRound,
  UserX,
  WalletCards,
  X,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import {
  caseCode,
  formatDate,
  formatDateTime,
  money,
  normalizeWhatsapp,
  whatsappUrl,
} from "./lib/format";
import type {
  CaseStatus,
  CaseUpdate,
  NevCase,
  Priority,
  Profile,
  RefundInstallment,
  RefundPlan,
  ResolutionType,
  UserRole,
} from "./lib/types";

type Tab = "dashboard" | "cases" | "refunds" | "team";

const statusLabels: Record<CaseStatus, string> = {
  open: "Novo",
  in_progress: "Em atendimento",
  waiting_customer: "Aguardando cliente",
  resolved: "Resolvido",
  cancelled: "Cancelado",
};

const priorityLabels: Record<Priority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const issueLabels: Record<string, string> = {
  thai_order: "Pedido tailandês",
  missing_item: "Produto não recebido",
  wrong_item: "Produto incorreto",
  quality: "Problema de qualidade",
  refund: "Solicitação de reembolso",
  other: "Outro",
};

const resolutionLabels: Record<ResolutionType, string> = {
  store_credit: "Crédito em produtos",
  reorder: "Refazer o pedido",
  installment_refund: "Reembolso parcelado",
  other: "Outra solução",
};

const navItems: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "Visão geral", icon: LayoutDashboard },
  { id: "cases", label: "Atendimentos", icon: Headphones },
  { id: "refunds", label: "Reembolsos", icon: HandCoins },
  { id: "team", label: "Equipe", icon: UsersRound },
];

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand ${inverse ? "brand--inverse" : ""}`}>
      <span className="brand__mark" aria-hidden="true">
        <Sparkles size={20} strokeWidth={2.2} />
      </span>
      <span className="brand__text">
        <strong>Nova Era</strong>
        <small>VENDUSS</small>
      </span>
    </div>
  );
}

function CenteredLoader({ label = "Carregando..." }: { label?: string }) {
  return (
    <main className="centered-screen">
      <Brand />
      <div className="loader-line">
        <Loader2 className="spin" size={20} />
        <span>{label}</span>
      </div>
    </main>
  );
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
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setMessage({
          kind: "error",
          text: error.message.toLowerCase().includes("invalid login")
            ? "E-mail ou senha incorretos."
            : error.message,
        });
      }
    } else {
      if (fullName.trim().length < 2) {
        setMessage({ kind: "error", text: "Informe seu nome completo." });
        setBusy(false);
        return;
      }
      if (password.length < 6) {
        setMessage({ kind: "error", text: "A senha precisa ter pelo menos 6 caracteres." });
        setBusy(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        setMessage({ kind: "error", text: error.message });
      } else if (!data.session) {
        setMessage({
          kind: "success",
          text: "Cadastro recebido. Confirme o e-mail e depois entre com sua senha.",
        });
      }
    }
    setBusy(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div>
          <Brand inverse />
          <div className="auth-story__copy">
            <span className="eyebrow eyebrow--light">CENTRAL DE PENDÊNCIAS</span>
            <h1>Cada cliente acompanhado até a solução.</h1>
            <p>
              Organize atendimentos, acordos e reembolsos em um único lugar — com histórico claro para toda a equipe.
            </p>
          </div>
        </div>
        <div className="auth-proof">
          <span className="auth-proof__icon"><ShieldCheck size={20} /></span>
          <div>
            <strong>Dados protegidos</strong>
            <small>Acesso individual e permissões por atendente.</small>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__mobile-brand"><Brand /></div>
          <div className="auth-card__heading">
            <span className="eyebrow">ÁREA DA EQUIPE</span>
            <h2>{mode === "login" ? "Que bom ter você de volta" : "Crie seu acesso"}</h2>
            <p>
              {mode === "login"
                ? "Entre para continuar os atendimentos."
                : "O administrador aprova novos atendentes após o cadastro."}
            </p>
          </div>

          <form onSubmit={submit} className="form-stack">
            {mode === "signup" && (
              <label className="field">
                <span>Nome completo</span>
                <div className="input-wrap">
                  <UsersRound size={18} />
                  <input
                    autoComplete="name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Seu nome"
                    required
                  />
                </div>
              </label>
            )}
            <label className="field">
              <span>E-mail</span>
              <div className="input-wrap">
                <Mail size={18} />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="voce@novaera.com"
                  required
                />
              </div>
            </label>
            <label className="field">
              <span>Senha</span>
              <div className="input-wrap">
                <LockKeyhole size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  className="icon-button icon-button--inside"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {message && <div className={`form-message form-message--${message.kind}`}>{message.text}</div>}

            <button className="button button--primary button--full" type="submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={18} /> : null}
              {mode === "login" ? "Entrar no sistema" : "Criar meu acesso"}
            </button>
          </form>

          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode((current) => (current === "login" ? "signup" : "login"));
              setMessage(null);
            }}
          >
            {mode === "login" ? "Primeiro acesso? Cadastre-se" : "Já possui acesso? Entrar"}
          </button>
        </div>
      </section>
    </main>
  );
}

function AccessSetup({
  userId,
  onReady,
  onSignOut,
}: {
  userId: string;
  onReady: (profile: Profile) => void;
  onSignOut: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error: claimError } = await supabase.rpc("nev_claim_access", {
      p_bootstrap_token: token.trim(),
    });
    if (claimError) {
      setError(claimError.message.includes("Chave inicial") ? "A chave informada não confere." : claimError.message);
      setBusy(false);
      return;
    }
    const { data, error: profileError } = await supabase
      .from("nev_profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (profileError) setError(profileError.message);
    else onReady(data as Profile);
    setBusy(false);
  }

  return (
    <main className="centered-screen setup-screen">
      <Brand />
      <section className="setup-card">
        <span className="setup-card__icon"><ShieldCheck size={24} /></span>
        <span className="eyebrow">CONFIGURAÇÃO INICIAL</span>
        <h1>Ative o primeiro administrador</h1>
        <p>Digite a chave inicial entregue com o sistema. Ela será usada uma única vez.</p>
        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            <span>Chave inicial</span>
            <div className="input-wrap">
              <LockKeyhole size={18} />
              <input value={token} onChange={(event) => setToken(event.target.value)} required autoFocus />
            </div>
          </label>
          {error && <div className="form-message form-message--error">{error}</div>}
          <button className="button button--primary button--full" disabled={busy}>
            {busy && <Loader2 className="spin" size={18} />}
            {busy ? "Ativando..." : "Ativar administração"}
          </button>
        </form>
        <button className="text-button" type="button" onClick={onSignOut}>Sair e usar outra conta</button>
      </section>
    </main>
  );
}

function PendingAccess({ profile, onReload, onSignOut }: { profile: Profile; onReload: () => void; onSignOut: () => void }) {
  return (
    <main className="centered-screen setup-screen">
      <Brand />
      <section className="setup-card">
        <span className="setup-card__icon setup-card__icon--amber"><Clock3 size={24} /></span>
        <span className="eyebrow">ACESSO EM ANÁLISE</span>
        <h1>Cadastro recebido</h1>
        <p>
          Olá, {profile.full_name?.split(" ")[0] || "atendente"}. Um administrador precisa liberar seu acesso.
        </p>
        <div className="pending-email"><Mail size={17} /> {profile.email}</div>
        <button className="button button--primary button--full" onClick={onReload}>
          <RefreshCw size={17} /> Verificar aprovação
        </button>
        <button className="text-button" type="button" onClick={onSignOut}>Sair e usar outra conta</button>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  tone: "green" | "blue" | "amber" | "violet";
}) {
  return (
    <article className="stat-card">
      <div className={`stat-card__icon stat-card__icon--${tone}`}>{icon}</div>
      <div className="stat-card__content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={`badge badge--${status}`}>{statusLabels[status]}</span>;
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`priority priority--${priority}`}><i />{priorityLabels[priority]}</span>;
}

function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function CaseList({ cases, onOpen }: { cases: NevCase[]; onOpen: (item: NevCase) => void }) {
  if (cases.length === 0) {
    return <EmptyState icon={<ClipboardList size={24} />} title="Nenhum atendimento aqui" text="Os registros aparecem assim que a equipe cadastrar uma pendência." />;
  }
  return (
    <div className="case-list">
      <div className="case-table case-table--head">
        <span>Cliente</span>
        <span>Pendência</span>
        <span>Valor</span>
        <span>Status</span>
        <span>Prioridade</span>
        <span />
      </div>
      {cases.map((item) => (
        <button className="case-table case-table--row" key={item.id} onClick={() => onOpen(item)}>
          <span className="case-customer">
            <i>{item.customer_name.slice(0, 1).toUpperCase()}</i>
            <span><strong>{item.customer_name}</strong><small>{caseCode(item.case_number)} · {formatDate(item.created_at)}</small></span>
          </span>
          <span className="case-issue"><strong>{issueLabels[item.issue_type] || "Outro"}</strong><small>{item.issue_description}</small></span>
          <span className="case-money">{money.format(Number(item.order_value))}</span>
          <span><StatusBadge status={item.status} /></span>
          <span><PriorityBadge priority={item.priority} /></span>
          <span className="case-arrow"><ChevronRight size={18} /></span>
        </button>
      ))}
    </div>
  );
}

function NewCaseModal({
  profile,
  onClose,
  onCreated,
}: {
  profile: Profile;
  onClose: () => void;
  onCreated: (item: NevCase) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [orderValue, setOrderValue] = useState("");
  const [issueType, setIssueType] = useState("thai_order");
  const [priority, setPriority] = useState<Priority>("normal");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const phone = normalizeWhatsapp(whatsapp);
    if (phone.length < 10 || phone.length > 15) {
      setError("Confira o número do WhatsApp, incluindo o DDD.");
      return;
    }
    const value = Number(orderValue.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      setError("Informe um valor válido para o pedido.");
      return;
    }
    setBusy(true);
    const { data, error: insertError } = await supabase
      .from("nev_cases")
      .insert({
        customer_name: customerName.trim(),
        whatsapp: phone,
        order_value: value,
        issue_type: issueType,
        issue_description: description.trim(),
        priority,
        status: "open",
        assigned_to: profile.user_id,
        created_by: profile.user_id,
      })
      .select("*")
      .single();

    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    await supabase.from("nev_case_updates").insert({
      case_id: data.id,
      author_id: profile.user_id,
      kind: "status",
      body: "Atendimento cadastrado e incluído na fila.",
    });
    onCreated(data as NevCase);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--form" role="dialog" aria-modal="true" aria-label="Novo atendimento">
        <header className="modal__header">
          <div><span className="eyebrow">NOVO REGISTRO</span><h2>Iniciar atendimento</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <form onSubmit={submit} className="modal__body form-grid">
          <label className="field field--wide">
            <span>Nome do cliente</span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ex.: Daniel de Souza" required autoFocus />
          </label>
          <label className="field">
            <span>WhatsApp com DDD</span>
            <input inputMode="tel" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="(19) 99999-9999" required />
          </label>
          <label className="field">
            <span>Valor do pedido</span>
            <div className="money-input"><span>R$</span><input inputMode="decimal" value={orderValue} onChange={(event) => setOrderValue(event.target.value)} placeholder="0,00" required /></div>
          </label>
          <label className="field">
            <span>Tipo de pendência</span>
            <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
              {Object.entries(issueLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Prioridade</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
              {Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field field--wide">
            <span>O que aconteceu?</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva a pendência, o que já foi combinado e qualquer informação importante..." rows={5} required />
          </label>
          {error && <div className="form-message form-message--error field--wide">{error}</div>}
          <footer className="modal__actions field--wide">
            <button type="button" className="button button--ghost" onClick={onClose}>Cancelar</button>
            <button className="button button--primary" disabled={busy}>
              {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              Abrir atendimento
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CaseDetailsModal({
  item,
  profile,
  profiles,
  onClose,
  onChanged,
}: {
  item: NevCase;
  profile: Profile;
  profiles: Profile[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [updates, setUpdates] = useState<CaseUpdate[]>([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [resolutionType, setResolutionType] = useState<ResolutionType>("store_credit");
  const [resolutionAmount, setResolutionAmount] = useState(String(item.order_value).replace(".", ","));
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [installmentCount, setInstallmentCount] = useState("3");
  const [assignedTo, setAssignedTo] = useState(item.assigned_to || "");
  const [firstDueDate, setFirstDueDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    return date.toISOString().slice(0, 10);
  });

  const loadTimeline = useCallback(async () => {
    const { data } = await supabase
      .from("nev_case_updates")
      .select("*")
      .eq("case_id", item.id)
      .order("created_at", { ascending: false });
    setUpdates((data || []) as CaseUpdate[]);
    setLoadingTimeline(false);
  }, [item.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTimeline(), 0);
    return () => window.clearTimeout(timer);
  }, [loadTimeline]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    const { error: noteError } = await supabase.from("nev_case_updates").insert({
      case_id: item.id,
      author_id: profile.user_id,
      kind: "note",
      body: note.trim(),
    });
    if (noteError) setError(noteError.message);
    else { setNote(""); await loadTimeline(); }
    setBusy(false);
  }

  async function changeStatus(status: CaseStatus) {
    setBusy(true);
    setError("");
    const { error: updateError } = await supabase.from("nev_cases").update({ status }).eq("id", item.id);
    if (updateError) setError(updateError.message);
    else {
      await supabase.from("nev_case_updates").insert({
        case_id: item.id,
        author_id: profile.user_id,
        kind: "status",
        body: `Status alterado para ${statusLabels[status]}.`,
      });
      onChanged();
      onClose();
    }
    setBusy(false);
  }

  async function assignTo(userId: string) {
    setBusy(true);
    const { error: assignError } = await supabase.from("nev_cases").update({ assigned_to: userId }).eq("id", item.id);
    if (assignError) setError(assignError.message);
    else { setAssignedTo(userId); onChanged(); }
    setBusy(false);
  }

  async function resolve(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const amount = Number(resolutionAmount.replace(",", "."));
    const installments = Number(installmentCount);
    if (Number.isNaN(amount) || amount < 0) {
      setError("Informe um valor válido para a solução.");
      setBusy(false);
      return;
    }
    const { error: resolveError } = await supabase.rpc("nev_apply_resolution", {
      p_case_id: item.id,
      p_resolution_type: resolutionType,
      p_amount: amount,
      p_notes: resolutionNotes.trim(),
      p_installments: resolutionType === "installment_refund" ? installments : null,
      p_first_due_date: resolutionType === "installment_refund" ? firstDueDate : null,
    });
    if (resolveError) setError(resolveError.message);
    else { onChanged(); onClose(); }
    setBusy(false);
  }

  const assigned = profiles.find((person) => person.user_id === assignedTo);
  const amount = Number(resolutionAmount.replace(",", ".")) || 0;
  const installmentPreview = amount / Math.max(Number(installmentCount) || 1, 1);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--details" role="dialog" aria-modal="true" aria-label={`Atendimento ${caseCode(item.case_number)}`}>
        <header className="modal__header details-header">
          <div>
            <button className="details-back" onClick={onClose}><ArrowLeft size={17} /> Voltar</button>
            <div className="details-title"><span>{caseCode(item.case_number)}</span><StatusBadge status={item.status} /></div>
            <h2>{item.customer_name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>

        <div className="details-layout">
          <div className="details-main">
            {!resolutionOpen ? (
              <>
                <section className="details-summary">
                  <div><span>Pendência</span><strong>{issueLabels[item.issue_type] || "Outro"}</strong></div>
                  <div><span>Valor do pedido</span><strong>{money.format(Number(item.order_value))}</strong></div>
                  <div><span>Prioridade</span><PriorityBadge priority={item.priority} /></div>
                </section>
                <section className="details-block">
                  <h3>Relato da pendência</h3>
                  <p>{item.issue_description}</p>
                </section>
                {item.resolution_type && (
                  <section className="resolution-record">
                    <span><CheckCircle2 size={19} /> Solução definida</span>
                    <strong>{resolutionLabels[item.resolution_type]}</strong>
                    <p>{item.resolution_notes || "Sem observações adicionais."}</p>
                    <small>Valor acordado: {money.format(Number(item.resolution_amount || 0))}</small>
                  </section>
                )}
                <section className="details-block">
                  <div className="section-title"><div><span className="eyebrow">HISTÓRICO</span><h3>Movimentações</h3></div></div>
                  <form className="note-form" onSubmit={addNote}>
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Adicionar observação do atendimento..." rows={3} />
                    <button className="button button--dark" disabled={busy || !note.trim()}><Send size={16} /> Registrar nota</button>
                  </form>
                  <div className="timeline">
                    {loadingTimeline ? <div className="loader-line"><Loader2 className="spin" size={17} /> Carregando histórico...</div> : updates.length === 0 ? <p className="muted">Nenhuma movimentação registrada.</p> : updates.map((update) => {
                      const author = profiles.find((person) => person.user_id === update.author_id);
                      return (
                        <div className="timeline__item" key={update.id}>
                          <span className={`timeline__dot timeline__dot--${update.kind}`}>{update.kind === "payment" ? <CircleDollarSign size={14} /> : update.kind === "resolution" ? <Check size={14} /> : <Circle size={10} />}</span>
                          <div><strong>{update.body}</strong><small>{author?.full_name || author?.email || "Sistema"} · {formatDateTime(update.created_at)}</small></div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : (
              <form className="resolution-form" onSubmit={resolve}>
                <button className="details-back" type="button" onClick={() => setResolutionOpen(false)}><ArrowLeft size={17} /> Voltar ao atendimento</button>
                <span className="eyebrow">DEFINIR SOLUÇÃO</span>
                <h3>Como essa pendência será resolvida?</h3>
                <div className="resolution-options">
                  {(Object.entries(resolutionLabels) as Array<[ResolutionType, string]>).map(([value, label]) => (
                    <button className={`resolution-option ${resolutionType === value ? "is-selected" : ""}`} type="button" key={value} onClick={() => setResolutionType(value)}>
                      <span>{value === "store_credit" ? <WalletCards size={19} /> : value === "reorder" ? <RefreshCw size={19} /> : value === "installment_refund" ? <HandCoins size={19} /> : <FileText size={19} />}</span>
                      <strong>{label}</strong>
                      {resolutionType === value && <Check size={16} />}
                    </button>
                  ))}
                </div>
                <div className="form-grid">
                  <label className="field">
                    <span>Valor da solução</span>
                    <div className="money-input"><span>R$</span><input inputMode="decimal" value={resolutionAmount} onChange={(event) => setResolutionAmount(event.target.value)} required /></div>
                  </label>
                  {resolutionType === "installment_refund" && (
                    <label className="field">
                      <span>Quantidade de parcelas</span>
                      <select value={installmentCount} onChange={(event) => setInstallmentCount(event.target.value)}>
                        {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count}x de {money.format(amount / count)}</option>)}
                      </select>
                    </label>
                  )}
                  {resolutionType === "installment_refund" && (
                    <label className="field">
                      <span>Vencimento da 1ª parcela</span>
                      <input type="date" value={firstDueDate} onChange={(event) => setFirstDueDate(event.target.value)} required />
                    </label>
                  )}
                  <label className={`field ${resolutionType !== "installment_refund" ? "field--wide" : ""}`}>
                    <span>Detalhes do acordo</span>
                    <textarea value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Registre tudo que ficou combinado com o cliente..." rows={4} />
                  </label>
                </div>
                {resolutionType === "installment_refund" && (
                  <div className="installment-preview"><CalendarClock size={20} /><div><span>Previsão do acordo</span><strong>{installmentCount} parcelas de aproximadamente {money.format(installmentPreview)}</strong></div></div>
                )}
                {error && <div className="form-message form-message--error">{error}</div>}
                <button className="button button--success button--full" disabled={busy}>
                  {busy ? <Loader2 className="spin" size={17} /> : <CheckCircle2 size={17} />}
                  Confirmar solução e resolver
                </button>
              </form>
            )}
          </div>

          <aside className="details-aside">
            <a className="whatsapp-button" href={whatsappUrl(item.whatsapp)} target="_blank" rel="noreferrer"><MessageCircle size={19} /> Chamar no WhatsApp</a>
            <div className="aside-section">
              <span className="aside-label">Responsável</span>
              <select value={assignedTo} onChange={(event) => assignTo(event.target.value)} disabled={busy}>
                {profiles.filter((person) => person.active).map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name || person.email}</option>)}
              </select>
              <small>{assigned?.email}</small>
            </div>
            <div className="aside-section">
              <span className="aside-label">WhatsApp</span>
              <strong>+{item.whatsapp}</strong>
              <span className="aside-label">Aberto em</span>
              <strong>{formatDate(item.created_at)}</strong>
            </div>
            {item.status !== "resolved" && item.status !== "cancelled" && (
              <div className="aside-actions">
                <button className="button button--success button--full" onClick={() => setResolutionOpen(true)}><CheckCircle2 size={17} /> Definir solução</button>
                {item.status !== "in_progress" && <button className="button button--ghost button--full" onClick={() => changeStatus("in_progress")} disabled={busy}>Marcar em atendimento</button>}
                {item.status !== "waiting_customer" && <button className="button button--ghost button--full" onClick={() => changeStatus("waiting_customer")} disabled={busy}>Aguardar cliente</button>}
                <button className="text-button text-button--danger" onClick={() => changeStatus("cancelled")} disabled={busy}>Cancelar atendimento</button>
              </div>
            )}
            {item.status === "cancelled" && <button className="button button--ghost button--full" onClick={() => changeStatus("open")} disabled={busy}>Reabrir atendimento</button>}
            {error && !resolutionOpen && <div className="form-message form-message--error">{error}</div>}
          </aside>
        </div>
      </section>
    </div>
  );
}

function DashboardView({
  cases,
  refundPlans,
  onOpenCase,
  onNewCase,
  onNavigate,
}: {
  cases: NevCase[];
  refundPlans: RefundPlan[];
  onOpenCase: (item: NevCase) => void;
  onNewCase: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  const active = cases.filter((item) => !["resolved", "cancelled"].includes(item.status));
  const resolved = cases.filter((item) => item.status === "resolved");
  const pendingValue = active.reduce((total, item) => total + Number(item.order_value), 0);
  const resolvedValue = resolved.reduce((total, item) => total + Number(item.resolution_amount || item.order_value), 0);
  const installments = refundPlans.flatMap((plan) => plan.nev_refund_installments.map((installment) => ({ ...installment, plan })));
  const unpaid = installments.filter((item) => item.status === "pending");
  const unpaidValue = unpaid.reduce((total, item) => total + Number(item.amount), 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = unpaid.filter((item) => item.due_date < today);
  const queue = [
    { status: "open" as CaseStatus, label: "Novos", count: active.filter((item) => item.status === "open").length },
    { status: "in_progress" as CaseStatus, label: "Em atendimento", count: active.filter((item) => item.status === "in_progress").length },
    { status: "waiting_customer" as CaseStatus, label: "Aguardando cliente", count: active.filter((item) => item.status === "waiting_customer").length },
  ];
  const maxQueue = Math.max(...queue.map((item) => item.count), 1);
  const nextInstallments = unpaid.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4);

  return (
    <div className="view-stack">
      <section className="hero-row">
        <div><span className="eyebrow">RESUMO OPERACIONAL</span><h1>Visão geral</h1><p>Acompanhe o que precisa da atenção da equipe hoje.</p></div>
        <button className="button button--primary hero-new" onClick={onNewCase}><Plus size={18} /> Novo atendimento</button>
      </section>

      <section className="stats-grid">
        <StatCard label="Em atendimento" value={active.length} detail={`${queue[0].count} novos na fila`} icon={<Headphones size={21} />} tone="blue" />
        <StatCard label="Já resolvidos" value={resolved.length} detail="acordos concluídos" icon={<CheckCircle2 size={21} />} tone="green" />
        <StatCard label="Valor pendente" value={money.format(pendingValue)} detail="em pedidos abertos" icon={<WalletCards size={21} />} tone="amber" />
        <StatCard label="Parcelas a pagar" value={money.format(unpaidValue)} detail={`${unpaid.length} parcelas · ${overdue.length} atrasadas`} icon={<CalendarClock size={21} />} tone="violet" />
      </section>

      <section className="dashboard-grid">
        <article className="panel queue-panel">
          <div className="panel__header"><div><span className="eyebrow">FLUXO ATUAL</span><h2>Fila de atendimento</h2></div><button className="link-button" onClick={() => onNavigate("cases")}>Ver todos <ChevronRight size={16} /></button></div>
          <div className="queue-list">
            {queue.map((entry) => (
              <div className="queue-row" key={entry.status}>
                <div><StatusBadge status={entry.status} /><strong>{entry.count}</strong></div>
                <div className="progress"><i style={{ width: `${Math.max((entry.count / maxQueue) * 100, entry.count ? 10 : 0)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="resolved-value"><span><CheckCircle2 size={18} /> Valor já resolvido</span><strong>{money.format(resolvedValue)}</strong></div>
        </article>

        <article className="panel installments-panel">
          <div className="panel__header"><div><span className="eyebrow">FINANCEIRO</span><h2>Próximas parcelas</h2></div><button className="link-button" onClick={() => onNavigate("refunds")}>Abrir agenda <ChevronRight size={16} /></button></div>
          {nextInstallments.length === 0 ? <EmptyState icon={<CalendarDays size={23} />} title="Nenhuma parcela pendente" text="Os reembolsos parcelados aparecerão aqui." /> : (
            <div className="installment-mini-list">
              {nextInstallments.map((entry) => (
                <div className="installment-mini" key={entry.id}>
                  <span className={`date-tile ${entry.due_date < today ? "date-tile--late" : ""}`}><strong>{new Date(`${entry.due_date}T12:00:00`).getDate()}</strong><small>{new Date(`${entry.due_date}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
                  <div><strong>{entry.plan.nev_cases?.customer_name || "Cliente"}</strong><small>{caseCode(entry.plan.nev_cases?.case_number || 0)} · {entry.installment_number}ª de {entry.plan.installment_count}</small></div>
                  <b>{money.format(Number(entry.amount))}</b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="panel recent-panel">
        <div className="panel__header"><div><span className="eyebrow">ÚLTIMOS REGISTROS</span><h2>Atendimentos recentes</h2></div><button className="link-button" onClick={() => onNavigate("cases")}>Ver todos <ChevronRight size={16} /></button></div>
        <CaseList cases={cases.slice(0, 6)} onOpen={onOpenCase} />
      </section>
    </div>
  );
}

function CasesView({ cases, onOpenCase, onNewCase }: { cases: NevCase[]; onOpenCase: (item: NevCase) => void; onNewCase: () => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"active" | CaseStatus | "all">("active");
  const filtered = cases.filter((item) => {
    const query = search.toLowerCase().replace(/\D/g, "") || search.toLowerCase();
    const matchesSearch = !search || item.customer_name.toLowerCase().includes(search.toLowerCase()) || item.whatsapp.includes(query) || caseCode(item.case_number).toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "active" ? !["resolved", "cancelled"].includes(item.status) : item.status === filter);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="view-stack">
      <section className="hero-row"><div><span className="eyebrow">CENTRAL DE PENDÊNCIAS</span><h1>Atendimentos</h1><p>Consulte, atualize e resolva cada caso.</p></div><button className="button button--primary" onClick={onNewCase}><Plus size={18} /> Novo atendimento</button></section>
      <section className="panel cases-panel">
        <div className="filters">
          <label className="search-box"><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, WhatsApp ou protocolo" /></label>
          <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filtrar atendimentos">
            <option value="active">Pendentes</option><option value="all">Todos</option><option value="open">Novos</option><option value="in_progress">Em atendimento</option><option value="waiting_customer">Aguardando cliente</option><option value="resolved">Resolvidos</option><option value="cancelled">Cancelados</option>
          </select>
        </div>
        <div className="results-count"><strong>{filtered.length}</strong> {filtered.length === 1 ? "atendimento encontrado" : "atendimentos encontrados"}</div>
        <CaseList cases={filtered} onOpen={onOpenCase} />
      </section>
    </div>
  );
}

function RefundsView({ plans, onChanged }: { plans: RefundPlan[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<"pending" | "paid" | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const rows = plans.flatMap((plan) => plan.nev_refund_installments.map((installment) => ({ ...installment, plan })))
    .filter((entry) => filter === "all" || entry.status === filter)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const pending = plans.flatMap((plan) => plan.nev_refund_installments).filter((item) => item.status === "pending");
  const pendingValue = pending.reduce((sum, item) => sum + Number(item.amount), 0);
  const overdue = pending.filter((item) => item.due_date < today);

  async function togglePaid(entry: RefundInstallment, paid: boolean) {
    setBusyId(entry.id);
    setError("");
    const { error: paymentError } = await supabase.rpc("nev_mark_installment_paid", {
      p_installment_id: entry.id,
      p_paid: paid,
      p_notes: null,
    });
    if (paymentError) setError(paymentError.message);
    else onChanged();
    setBusyId(null);
  }

  return (
    <div className="view-stack">
      <section className="hero-row"><div><span className="eyebrow">AGENDA FINANCEIRA</span><h1>Reembolsos</h1><p>Acompanhe vencimentos e confirme cada pagamento.</p></div></section>
      <section className="refund-stats">
        <div><span>Saldo a pagar</span><strong>{money.format(pendingValue)}</strong><small>{pending.length} parcelas pendentes</small></div>
        <div><span>Parcelas atrasadas</span><strong className={overdue.length ? "danger-text" : ""}>{overdue.length}</strong><small>{money.format(overdue.reduce((sum, item) => sum + Number(item.amount), 0))} em atraso</small></div>
        <div><span>Acordos ativos</span><strong>{plans.filter((plan) => plan.status === "open").length}</strong><small>reembolsos em andamento</small></div>
      </section>
      <section className="panel refunds-panel">
        <div className="panel__header refunds-header"><div><span className="eyebrow">PARCELAS</span><h2>Agenda de pagamentos</h2></div><div className="segmented"><button className={filter === "pending" ? "is-active" : ""} onClick={() => setFilter("pending")}>Pendentes</button><button className={filter === "paid" ? "is-active" : ""} onClick={() => setFilter("paid")}>Pagas</button><button className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>Todas</button></div></div>
        {error && <div className="form-message form-message--error">{error}</div>}
        {rows.length === 0 ? <EmptyState icon={<ReceiptText size={24} />} title="Nenhuma parcela nesta lista" text="Quando um reembolso parcelado for combinado, os vencimentos serão criados automaticamente." /> : (
          <div className="refund-list">
            {rows.map((entry) => {
              const late = entry.status === "pending" && entry.due_date < today;
              return (
                <article className="refund-row" key={entry.id}>
                  <span className={`date-tile ${late ? "date-tile--late" : entry.status === "paid" ? "date-tile--paid" : ""}`}><strong>{new Date(`${entry.due_date}T12:00:00`).getDate()}</strong><small>{new Date(`${entry.due_date}T12:00:00`).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
                  <div className="refund-customer"><strong>{entry.plan.nev_cases?.customer_name || "Cliente"}</strong><small>{caseCode(entry.plan.nev_cases?.case_number || 0)} · Parcela {entry.installment_number}/{entry.plan.installment_count}</small></div>
                  <div className="refund-due"><span>Vencimento</span><strong>{formatDate(entry.due_date)}</strong></div>
                  <strong className="refund-amount">{money.format(Number(entry.amount))}</strong>
                  <div className="refund-status">{entry.status === "paid" ? <span className="paid-label"><CheckCircle2 size={16} /> Pago</span> : late ? <span className="late-label"><AlertTriangle size={16} /> Atrasado</span> : <span className="pending-label"><Clock3 size={16} /> Pendente</span>}</div>
                  <button className={`button ${entry.status === "paid" ? "button--ghost" : "button--success"}`} disabled={busyId === entry.id} onClick={() => togglePaid(entry, entry.status !== "paid")}>
                    {busyId === entry.id ? <Loader2 className="spin" size={16} /> : entry.status === "paid" ? <RefreshCw size={16} /> : <Check size={16} />}
                    {entry.status === "paid" ? "Desmarcar" : "Marcar pago"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TeamView({ profile, profiles, onChanged }: { profile: Profile; profiles: Profile[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const isAdmin = profile.role === "admin";
  const sorted = [...profiles].sort((a, b) => Number(a.active) - Number(b.active) || (a.full_name || a.email).localeCompare(b.full_name || b.email));

  async function changePerson(person: Profile, active: boolean, role: UserRole) {
    setBusyId(person.user_id);
    setError("");
    const { error: updateError } = await supabase.rpc("nev_admin_set_profile", {
      p_user_id: person.user_id,
      p_active: active,
      p_role: role,
    });
    if (updateError) setError(updateError.message);
    else onChanged();
    setBusyId(null);
  }

  return (
    <div className="view-stack">
      <section className="hero-row"><div><span className="eyebrow">ACESSOS E PERMISSÕES</span><h1>Equipe</h1><p>Aprove atendentes e defina quem pode administrar o sistema.</p></div></section>
      <section className="team-guide"><span><UserCheck size={22} /></span><div><strong>Como adicionar um atendente?</strong><p>Peça para a pessoa abrir o link do sistema e clicar em “Primeiro acesso”. O cadastro aparecerá abaixo para aprovação.</p></div></section>
      <section className="panel team-panel">
        <div className="panel__header"><div><span className="eyebrow">USUÁRIOS</span><h2>{profiles.length} {profiles.length === 1 ? "pessoa cadastrada" : "pessoas cadastradas"}</h2></div></div>
        {!isAdmin && <div className="form-message form-message--info">Você pode consultar a equipe, mas apenas administradores alteram acessos.</div>}
        {error && <div className="form-message form-message--error">{error}</div>}
        <div className="team-list">
          {sorted.map((person) => (
            <article className="team-row" key={person.user_id}>
              <span className="avatar">{(person.full_name || person.email).slice(0, 1).toUpperCase()}</span>
              <div className="team-person"><strong>{person.full_name || "Nome não informado"}{person.user_id === profile.user_id && <em>Você</em>}</strong><small>{person.email}</small></div>
              <span className={`access-status ${person.active ? "access-status--active" : "access-status--pending"}`}>{person.active ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}{person.active ? "Ativo" : "Aguardando aprovação"}</span>
              <select value={person.role} disabled={!isAdmin || busyId === person.user_id} onChange={(event) => changePerson(person, person.active, event.target.value as UserRole)}><option value="agent">Atendente</option><option value="admin">Administrador</option></select>
              {isAdmin && (person.active ? <button className="button button--ghost" disabled={busyId === person.user_id} onClick={() => changePerson(person, false, person.role)}>{busyId === person.user_id ? <Loader2 className="spin" size={16} /> : <UserX size={16} />} Desativar</button> : <button className="button button--success" disabled={busyId === person.user_id} onClick={() => changePerson(person, true, person.role)}>{busyId === person.user_id ? <Loader2 className="spin" size={16} /> : <UserCheck size={16} />} Aprovar</button>)}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AppWorkspace({ profile, onSignOut }: { profile: Profile; onSignOut: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [cases, setCases] = useState<NevCase[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [refundPlans, setRefundPlans] = useState<RefundPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<NevCase | null>(null);
  const [toast, setToast] = useState("");

  const loadAll = useCallback(async () => {
    const [caseResult, profileResult, refundResult] = await Promise.all([
      supabase.from("nev_cases").select("*").order("created_at", { ascending: false }),
      supabase.from("nev_profiles").select("*").order("created_at", { ascending: true }),
      supabase.from("nev_refund_plans").select("*, nev_cases(id, case_number, customer_name, whatsapp), nev_refund_installments(*)").order("created_at", { ascending: false }),
    ]);
    const error = caseResult.error || profileResult.error || refundResult.error;
    if (error) setLoadError(error.message);
    else {
      setLoadError("");
      setCases((caseResult.data || []) as NevCase[]);
      setProfiles((profileResult.data || []) as Profile[]);
      setRefundPlans((refundResult.data || []) as unknown as RefundPlan[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAll(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function changed(message?: string) {
    void loadAll();
    if (message) setToast(message);
  }

  const currentCases = useMemo(() => cases, [cases]);
  const activeCount = cases.filter((item) => !["resolved", "cancelled"].includes(item.status)).length;
  const pendingTeam = profiles.filter((person) => !person.active).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand inverse />
        <nav className="sidebar__nav">
          <span className="nav-label">MENU</span>
          {navItems.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setActiveTab(item.id)}><Icon size={19} /><span>{item.label}</span>{item.id === "cases" && activeCount > 0 && <b>{activeCount}</b>}{item.id === "team" && pendingTeam > 0 && <b className="nav-alert">{pendingTeam}</b>}</button>;
          })}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar-user"><span>{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span><div><strong>{profile.full_name || "Atendente"}</strong><small>{profile.role === "admin" ? "Administrador" : "Atendente"}</small></div></div>
          <button className="sidebar-signout" onClick={onSignOut} aria-label="Sair"><LogOut size={18} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-mobile-brand"><Brand /></div>
          <div className="topbar__date"><CalendarDays size={17} /> {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
          <div className="topbar__actions"><button className="icon-button" onClick={() => { setLoading(true); void loadAll(); }} aria-label="Atualizar"><RefreshCw size={18} className={loading ? "spin" : ""} /></button><button className="topbar-user" onClick={() => setActiveTab("team")}><span>{(profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span><div><strong>{profile.full_name?.split(" ")[0] || "Atendente"}</strong><small>{profile.role === "admin" ? "Admin" : "Equipe"}</small></div></button></div>
        </header>
        <div className="workspace__content">
          {loadError && <div className="form-message form-message--error load-error">Não foi possível carregar os dados: {loadError} <button onClick={() => void loadAll()}>Tentar novamente</button></div>}
          {loading && cases.length === 0 ? <div className="content-loader"><Loader2 className="spin" size={24} /> Preparando seu painel...</div> : (
            <>
              {activeTab === "dashboard" && <DashboardView cases={currentCases} refundPlans={refundPlans} onOpenCase={setSelectedCase} onNewCase={() => setNewCaseOpen(true)} onNavigate={setActiveTab} />}
              {activeTab === "cases" && <CasesView cases={currentCases} onOpenCase={setSelectedCase} onNewCase={() => setNewCaseOpen(true)} />}
              {activeTab === "refunds" && <RefundsView plans={refundPlans} onChanged={() => changed("Pagamento atualizado.")} />}
              {activeTab === "team" && <TeamView profile={profile} profiles={profiles} onChanged={() => changed("Acesso da equipe atualizado.")} />}
            </>
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        {navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setActiveTab(item.id)}><Icon size={20} /><span>{item.label === "Visão geral" ? "Início" : item.label}</span>{item.id === "team" && pendingTeam > 0 && <i>{pendingTeam}</i>}</button>; })}
      </nav>

      {newCaseOpen && <NewCaseModal profile={profile} onClose={() => setNewCaseOpen(false)} onCreated={() => { setNewCaseOpen(false); changed("Atendimento criado com sucesso."); }} />}
      {selectedCase && <CaseDetailsModal item={selectedCase} profile={profile} profiles={profiles} onClose={() => setSelectedCase(null)} onChanged={() => changed("Atendimento atualizado.")} />}
      {toast && <div className="toast"><CheckCircle2 size={18} /> {toast}</div>}
    </div>
  );
}

function AuthenticatedRoot({ session }: { session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [error, setError] = useState("");

  const loadAccess = useCallback(async () => {
    const { error: claimError } = await supabase.rpc("nev_claim_access");
    if (claimError?.message.includes("Chave inicial")) {
      setNeedsBootstrap(true);
      setLoading(false);
      return;
    }
    if (claimError) {
      setError(claimError.message);
      setLoading(false);
      return;
    }
    const { data, error: profileError } = await supabase.from("nev_profiles").select("*").eq("user_id", session.user.id).single();
    if (profileError) setError(profileError.message);
    else { setError(""); setProfile(data as Profile); setNeedsBootstrap(false); }
    setLoading(false);
  }, [session.user.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadAccess(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccess]);

  async function signOut() { await supabase.auth.signOut(); }

  if (loading) return <CenteredLoader label="Verificando seu acesso..." />;
  if (error) return <main className="centered-screen setup-screen"><Brand /><section className="setup-card"><span className="setup-card__icon setup-card__icon--red"><AlertTriangle size={24} /></span><h1>Não foi possível entrar</h1><p>{error}</p><button className="button button--primary button--full" onClick={() => { setLoading(true); void loadAccess(); }}><RefreshCw size={17} /> Tentar novamente</button><button className="text-button" onClick={signOut}>Sair</button></section></main>;
  if (needsBootstrap) return (
    <AccessSetup
      userId={session.user.id}
      onReady={(newProfile) => {
        setProfile(newProfile);
        setNeedsBootstrap(false);
      }}
      onSignOut={signOut}
    />
  );
  if (!profile) return <CenteredLoader />;
  if (!profile.active) return <PendingAccess profile={profile} onReload={() => { setLoading(true); void loadAccess(); }} onSignOut={signOut} />;
  return <AppWorkspace profile={profile} onSignOut={signOut} />;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <CenteredLoader />;
  if (!session) return <AuthScreen />;
  return <AuthenticatedRoot session={session} />;
}
