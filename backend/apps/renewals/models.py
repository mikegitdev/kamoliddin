"""Retired: campaigns are paid once per order; there is no auto-renewal.

The app stays installed only so its migration chain can drop the former
RenewalAgreement / RenewalAttempt tables (migration 0004)."""
