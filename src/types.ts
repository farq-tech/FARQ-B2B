export type AppView =
  | 'login'
  | 'home'
  | 'material-prices'
  | 'create-upload'
  | 'create-proposals'
  | 'sent'
  | 'sent-failure'
  | 'rfq-list'
  | 'rfq-detail'
  | 'rfq-closed'
  | 'offers'
  | 'offer-detail'
  | 'comparison'
  | 'award'
  | 'award-success'
  | 'supplier-management'
  | 'supplier-detail'
  | 'settings'
  | 'reports'
  | 'learning-review'
  | 'access-denied'
  | 'supplier'
  | 'inbox'
  | 'inbox-thread'
  | 'invite'

/**
 * Where a supplier on a line came from. «من الكتالوج» is the neutral value: the
 * catalog returned the supplier and nothing says how strong the link is.
 */
export type EvidenceType = 'دليل مباشر' | 'نشاط متطابق' | 'دليل منتج' | 'من الكتالوج' | 'على مستوى النشاط' | 'اختيارك' | 'تسمية آلية' | 'خريطة فرق'
export type ChannelType = 'بريد' | 'واتساب' | 'محادثة'

export interface Supplier {
  id: string
  name: string
  city: string
  evidence: EvidenceType
  channel: ChannelType
  /** The buyer chose this supplier for this material before. */
  learned?: boolean
}

export interface BOQItem {
  id: number
  name: string
  qty: string
  unit: string
  spec?: string
  status: 'ready' | 'searching'
  supplierCount: number
  suppliers: Supplier[]
  /** Matched Farq catalog spec when available */
  farqSpecId?: string
  lineKey?: string
  /**
   * The model's NAME for a material the catalogue could not confirm. A review
   * suggestion, never a match: `farqSpecId` stays unset. Its suppliers come
   * from Farq's intent→supplier map for that name, not from the model.
   */
  aiSuggestion?: {
    intent: string
    family?: string | null
    supplierCount: number
    suppliers: Supplier[]
    zeroReason?: string | null
  }
  /** Suppliers the buyer dismissed for this material on this page (also stored server side). */
  rejectedSupplierIds?: string[]
  /** Trade known, material not in the list: suppliers of that trade, unconfirmed. */
  familySuggestion?: { family: string; suppliers: Supplier[] }
  /** Suppliers the buyer picked for this same line in an earlier booklet. Never preselected. */
  learnedSuggestion?: { suppliers: Supplier[] }
  /** Pure work (excavation, backfill…): nothing to buy, so no supplier is sought. */
  workOnly?: boolean
  /** The item code the booklet prints for this row. */
  itemCode?: string
  /**
   * The ontology NAMED this material and Farq's intent→supplier map was read
   * for that name. Not a catalogue match: `farqSpecId` stays unset and nothing
   * is preselected. `supplierCount: 0` means «معروف بلا مورد» — a fact about
   * the register, not about our understanding of the line.
   */
  mapSuggestion?: {
    intent: string
    family?: string | null
    /** SERVER_RESOLVED when the API named the line itself; WIRE_UNVERIFIED when it took this client's name. */
    answeredBy?: string | null
    supplierCount: number
    suppliers: Supplier[]
    zeroReason?: string | null
  }
}

export interface RFQSummary {
  id: string
  name: string
  items: number
  offers: number
  suppliers: number
  status: 'draft' | 'active' | 'awarded' | 'closed'
  date: string
  deadline?: string
  /** Short reference suppliers see, e.g. CIV-RFQ-51D17AF6. */
  reference?: string
  /** Department · city, under the project name. */
  subtitle?: string
  /** Suppliers the request reached, and those who answered. */
  sent?: number
  replied?: number
  /** When quotes close, as «يغلق بعد 3 أيام»; urgent inside two days. */
  closesLabel?: string
  closesUrgent?: boolean
}

export interface SupplierEntry {
  id: string
  name: string
  city: string
  category: string
  phone: string
  email: string
  interactions: number
  lastSeen: string
  manual?: boolean
  qualificationStatus?: string
  activity?: string
  hasEmail?: boolean
  hasWhatsapp?: boolean
  hasHaraj?: boolean
  sourceSystem?: string
  /** The upload that created this row — null for everything the sweeps found. */
  importBatchId?: string | null
}

export interface NavProps {
  navigate: (v: AppView) => void
  selectedSupplierId?: string | null
  setSelectedSupplierId?: (id: string | null) => void
}
