import { db } from '../connection';

// ---------------------------------------------------------------------------
// webhooks.ts — DB query functions for webhook subscriptions and deliveries
// ---------------------------------------------------------------------------

export interface WebhookSubscriptionRow {
  id: string;
  callback_url: string;
  event_types: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
  last_delivery_at: string | null;
  failure_count: number;
}

export interface WebhookDeliveryRow {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  created_at: string;
  last_attempt_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
}

export async function listSubscriptions(): Promise<WebhookSubscriptionRow[]> {
  return db<WebhookSubscriptionRow>('webhook_subscriptions').orderBy('created_at', 'desc');
}

export async function getSubscription(id: string): Promise<WebhookSubscriptionRow | undefined> {
  return db<WebhookSubscriptionRow>('webhook_subscriptions').where('id', id).first();
}

export async function insertSubscription(data: {
  callback_url: string;
  event_types: string[];
  secret: string;
}): Promise<WebhookSubscriptionRow> {
  const [row] = await db<WebhookSubscriptionRow>('webhook_subscriptions')
    .insert({
      callback_url: data.callback_url,
      event_types: data.event_types,
      secret: data.secret,
      is_active: true,
      failure_count: 0,
    })
    .returning('*');
  return row as WebhookSubscriptionRow;
}

export async function deleteSubscription(id: string): Promise<void> {
  await db('webhook_subscriptions').where('id', id).del();
}

export async function listDeliveriesForSubscription(subscriptionId: string): Promise<WebhookDeliveryRow[]> {
  return db<WebhookDeliveryRow>('webhook_deliveries')
    .where('subscription_id', subscriptionId)
    .orderBy('created_at', 'desc')
    .limit(100);
}
