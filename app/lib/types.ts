export type UserRole = "admin" | "agent";
export type CaseStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "cancelled";
export type ReviewStatus = "draft" | "pending" | "approved" | "changes_requested";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ResolutionType =
  | "store_credit"
  | "store_credit_venduss"
  | "store_credit_zero19"
  | "reorder"
  | "installment_refund"
  | "other";

export type Profile = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
  is_super_admin: boolean;
  notify_changes: boolean;
  created_at: string;
};

export type NevCustomer = {
  id: string;
  name: string;
  normalized_whatsapp: string;
  created_at: string;
};

export type OrderSystem = {
  id: string;
  label: string;
  base_url: string | null;
  sort_order: number;
  active: boolean;
};

export type CaseOrder = {
  id: string;
  case_id: string;
  system_id: string | null;
  system_label: string;
  order_number: string;
  order_date: string;
  amount: number;
  created_at: string;
};

export type NevCase = {
  id: string;
  case_number: number;
  customer_id: string;
  customer_name: string;
  whatsapp: string;
  order_value: number;
  issue_type: string;
  issue_description: string;
  status: CaseStatus;
  priority: Priority;
  assigned_to: string | null;
  created_by: string;
  review_status: ReviewStatus;
  review_requested_to: string | null;
  review_requested_at: string | null;
  review_decided_at: string | null;
  review_decided_by: string | null;
  review_note: string | null;
  current_action_user: string | null;
  resolution_type: ResolutionType | null;
  resolution_amount: number | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
};

export type CaseUpdate = {
  id: string;
  case_id: string;
  author_id: string | null;
  recipient_id: string | null;
  kind: "note" | "status" | "resolution" | "payment" | "attachment" | "approval" | "assignment" | "renegotiation";
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type CaseAttachment = {
  id: string;
  case_id: string;
  uploaded_by: string | null;
  category: "payment_receipt" | "shipping" | "problem" | "other";
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type CaseApproval = {
  id: string;
  case_id: string;
  requested_by: string;
  reviewer_id: string;
  status: "pending" | "approved" | "changes_requested" | "cancelled";
  request_note: string | null;
  response_note: string | null;
  requested_at: string;
  decided_at: string | null;
};

export type RefundInstallment = {
  id: string;
  refund_plan_id: string;
  installment_number: number;
  amount: number;
  paid_amount: number;
  due_date: string;
  status: "pending" | "partial" | "paid" | "cancelled";
  paid_at: string | null;
  notes: string | null;
  postponed_reason: string | null;
};

export type RefundPlan = {
  id: string;
  case_id: string;
  total_amount: number;
  installment_count: number;
  first_due_date: string;
  status: "open" | "paid" | "cancelled";
  created_at: string;
  nev_cases: Pick<NevCase, "id" | "case_number" | "customer_name" | "whatsapp"> | null;
  nev_refund_installments: RefundInstallment[];
};

export type TaskStatus = "open" | "in_progress" | "awaiting_creator" | "done" | "cancelled";
export type NevTask = {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  created_by: string;
  assigned_to: string;
  waiting_on: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  snooze_reason: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskUpdate = {
  id: string;
  task_id: string;
  author_id: string | null;
  recipient_id: string | null;
  kind: "note" | "question" | "answer" | "status" | "snooze";
  body: string;
  created_at: string;
  read_at: string | null;
};

export type AuditEvent = {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};
