import type { TimelineEntry } from '@/entities/timeline/model';
import {
  MessageDelivery,
  type DeliveryPort as MessageDeliveryPort,
} from '@/shared/messaging/delivery';
export type DeliveryPort = MessageDeliveryPort<TimelineEntry>;
export class DeliveryCoordinator extends MessageDelivery<TimelineEntry> {}
