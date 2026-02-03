import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import type {
  calls,
  recordings,
  transcripts,
  extractions,
  notifications,
} from "./schema";

export type Call = InferSelectModel<typeof calls>;
export type NewCall = InferInsertModel<typeof calls>;

export type Recording = InferSelectModel<typeof recordings>;
export type NewRecording = InferInsertModel<typeof recordings>;

export type Transcript = InferSelectModel<typeof transcripts>;
export type NewTranscript = InferInsertModel<typeof transcripts>;

export type Extraction = InferSelectModel<typeof extractions>;
export type NewExtraction = InferInsertModel<typeof extractions>;

export type Notification = InferSelectModel<typeof notifications>;
export type NewNotification = InferInsertModel<typeof notifications>;

export type ReservationDraft = {
  guestName: string;
  phone: string;
  email: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomType: "Single" | "Double" | "Triple" | "Suite";
  rateType: "Standard" | "Non-refundable" | "Half-board";
  notes: string;
  status: "Draft" | "Pending confirmation" | "Confirmed";
};
