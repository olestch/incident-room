import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Activity,
  Search,
  Target,
} from 'lucide-react';
import { severityLabels, statusLabels, type Incident } from '@/entities/incident/model';
import { Badge } from '@/shared/ui/primitives';

const severityIcons = { P1: AlertOctagon, P2: AlertTriangle, P3: AlertCircle, P4: Circle };
const lifecycleIcons = {
  triggered: AlertCircle,
  investigating: Search,
  identified: Target,
  monitoring: Activity,
  resolved: CheckCircle2,
};

export function SeverityBadge({ severity }: { severity: Incident['severity'] }) {
  const Icon = severityIcons[severity];
  return (
    <Badge className={`ui-severity ui-severity-${severity}`}>
      <Icon size={14} aria-hidden="true" />
      {severity} {severityLabels[severity]}
    </Badge>
  );
}
export function LifecycleBadge({ status }: { status: Incident['status'] }) {
  const Icon = lifecycleIcons[status];
  return (
    <Badge className={`ui-lifecycle ui-lifecycle-${status}`}>
      <Icon size={14} aria-hidden="true" />
      {statusLabels[status]}
    </Badge>
  );
}
