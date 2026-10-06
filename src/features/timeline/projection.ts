import type { TimelineEntry } from '@/entities/timeline/model';
import { StreamProjection, type StreamRow } from '@/shared/messaging/projection';
export type TimelineRow = StreamRow<TimelineEntry>;
export class TimelineProjection extends StreamProjection<TimelineEntry> {}
