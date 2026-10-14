/**
 * Unsaved-edits persistence for the campaign editor (localStorage).
 * Extracted from CampaignEditorPage so the storage contract — baseline
 * diffing, per-identity keys, version-guarded recovery — lives in one place.
 */

/** Baseline the working copy is diffed against (server content + the
 *  placement inputs captured when the editor opened / last saved). */
export interface Baseline {
  headline: string;
  body: string;
  bannerKey: string;
  start: string;
  end: string;
  selected: string[];
  autoRenew: boolean;
}

export interface Draft extends Baseline {
  bannerUrl: string;
  stage: number;
  baseUpdatedAt: string | null; // campaign.updated_at the draft was based on
  savedAt: number;
}

export const draftKeyFor = (campaignId: string | undefined, businessId: string) =>
  campaignId ? `campaign-draft:${campaignId}` : `campaign-draft:new:${businessId}`;

export function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export const clearDraft = (key: string) => localStorage.removeItem(key);
