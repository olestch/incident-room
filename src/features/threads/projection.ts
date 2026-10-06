import type { ThreadMessage } from '@/entities/thread/model';
import { StreamProjection, type StreamRow } from '@/shared/messaging/projection';
export type ThreadRow = StreamRow<ThreadMessage>;
export class ThreadProjection extends StreamProjection<ThreadMessage> {}
