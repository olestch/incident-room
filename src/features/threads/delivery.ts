import type { ThreadMessage } from '@/entities/thread/model';
import { MessageDelivery } from '@/shared/messaging/delivery';
export class ThreadDelivery extends MessageDelivery<ThreadMessage> {}
