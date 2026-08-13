export type UserRole = "admin" | "agent";
export type CaseStatus =
  | "open"
  | "in_progress"
  | "waiting_customer"
  | "resolved"
  | "cancelled";
export type Priority = "low" | "normal" | "high" | "urgent";
export type ResolutionType =
  | "store_credit"
  | "reorder"
  | "installment_refund"
  | "other";

export type Profile = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
};

export type NevCase = {
  id: string;
  case_number: number;
  customer_name: string;
  whatsapp: string;
  order_value: number;
  issue_type: string;
  issue_description: string;
  status: CaseStatus;
  priority: Priority;
  assigned_to: string | null;
  created_by: string;
  resolution_type: ResolutionType | null;
  resolution_amount: number | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CaseUpdate = {
  id: string;
  case_id: string;
  author_id: string | null;
  kind: "note" | "status" | "resolution" | "payment";
  body: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type RefundInstallment = {
  id: string;
  refund_plan_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: "pending" | "paid" | "cancelled";
  paid_at: string | null;
  notes: string | null;
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
