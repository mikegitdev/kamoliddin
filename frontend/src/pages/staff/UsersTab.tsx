import { useEffect, useState } from "react";
import {
  useAdminUser,
  useStaffPage,
  type ApiAdminUser,
} from "@/shared/api/queries";
import { formatDateTime, formatMinor, formatPhone } from "@/shared/format";
import { useI18n } from "@/shared/i18n";
import { OrderChip, QueryError } from "@/shared/ui";
import type { OrderState } from "@/entities/types";
import { IconBlock, IconCheck, IconShield } from "@/shared/icons";
import {
  ServerPager,
  StatusChip,
  shortId,
  useDebounced,
  useStaffAction,
  useStaffLink,
} from "./controls";

function userStatus(u: ApiAdminUser): string {
  if (u.is_deleted) return "deleted";
  return u.is_active ? "active" : "blocked";
}

export function UsersTab({ locale }: { locale: string }) {
  const { t } = useI18n();
  const lang = locale as "ru" | "uz";
  const link = useStaffLink();
  const [qInput, setQInput] = useState("");
  const q = useDebounced(qInput);
  const [status, setStatus] = useState(() => link.get("status"));
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [q, status]);
  const { data, isLoading, isError, refetch } = useStaffPage<ApiAdminUser>("users", { q, status }, offset);
  const selected = link.get("user");
  const action = useStaffAction();

  const toggleBlock = (u: ApiAdminUser) =>
    action.run({
      path: `users/${u.id}/${u.is_active ? "block" : "unblock"}`,
      body: `${formatPhone(u.phone_e164)} — ${u.is_active ? t.confirmBlockUser : t.confirmUnblockUser}`,
      confirmLabel: u.is_active ? t.block : t.unblock,
      danger: u.is_active,
    });

  return (
    <section>
      {selected && (
        <UserDetail
          id={selected}
          lang={lang}
          onClose={() => link.clear("user")}
          onToggleBlock={toggleBlock}
          busy={action.busy}
        />
      )}
      <div className="row mb-14">
        <input
          placeholder={`${t.phone}…`}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          className="max-w-280"
          aria-label={t.phone}
          inputMode="tel"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t.status}>
          <option value="">{t.statusAll}</option>
          <option value="active">{t.stUserActive}</option>
          <option value="blocked">{t.stUserBlocked}</option>
          <option value="staff">{t.roleStaff}</option>
          <option value="deleted">{t.stUserDeleted}</option>
        </select>
      </div>
      {isLoading && <div className="skeleton skeleton-card" />}
      {isError && <QueryError onRetry={() => refetch()} />}
      {data && (
        <p className="muted-2 mb-10">
          {t.countLabel}: {data.count}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t.phone}</th>
              <th>{t.role}</th>
              <th>{t.status}</th>
              <th>{t.businessesCount}</th>
              <th>{t.lastLogin}</th>
              <th>{t.joinedAt}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.results.map((u) => (
              <tr key={u.id} className={selected === u.id ? "staff-row-selected" : undefined}>
                <td>
                  <button className="link-button" onClick={() => link.go("users", { user: u.id })}>
                    <strong className="staff-phone">{formatPhone(u.phone_e164)}</strong>
                  </button>
                </td>
                <td className="muted-2">
                  {u.is_staff ? (
                    <>
                      <IconShield size={12} /> {t.roleStaff}
                    </>
                  ) : (
                    t.roleOwner
                  )}
                </td>
                <td>
                  <StatusChip status={userStatus(u)} />
                </td>
                <td>{u.businesses_count}</td>
                <td className="muted-2">{u.last_login ? formatDateTime(u.last_login, lang) : t.never}</td>
                <td className="muted-2">{formatDateTime(u.created_at, lang)}</td>
                <td>
                  <div className="row">
                    <button className="btn small" onClick={() => link.go("users", { user: u.id })}>
                      {t.details}
                    </button>
                    {!u.is_staff && !u.is_deleted && (
                      <button
                        className={`btn small${u.is_active ? " danger" : ""}`}
                        disabled={action.busy}
                        onClick={() => void toggleBlock(u)}
                      >
                        {u.is_active ? <IconBlock size={12} /> : <IconCheck size={12} />}{" "}
                        {u.is_active ? t.block : t.unblock}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && <ServerPager count={data.count} offset={offset} onOffset={setOffset} />}
    </section>
  );
}

function UserDetail({
  id,
  lang,
  onClose,
  onToggleBlock,
  busy,
}: {
  id: string;
  lang: "ru" | "uz";
  onClose: () => void;
  onToggleBlock: (u: ApiAdminUser) => Promise<boolean>;
  busy: boolean;
}) {
  const { t } = useI18n();
  const link = useStaffLink();
  const { data, isLoading, isError, refetch } = useAdminUser(id);
  if (isLoading) return <div className="skeleton skeleton-card mb-14" />;
  if (isError) return <QueryError onRetry={() => refetch()} />;
  if (!data) return null;
  const u = data.user;
  return (
    <div className="card mb-14 staff-detail">
      <div className="row-between">
        <h3>
          {formatPhone(u.phone_e164)} <StatusChip status={userStatus(u)} />
          {u.is_staff && (
            <span className="chip dark">
              <IconShield size={12} /> {t.roleStaff}
            </span>
          )}
        </h3>
        <div className="row">
          {!u.is_staff && !u.is_deleted && (
            <button
              className={`btn small${u.is_active ? " danger" : ""}`}
              disabled={busy}
              onClick={() => void onToggleBlock(u)}
            >
              {u.is_active ? t.block : t.unblock}
            </button>
          )}
          <button className="btn small" onClick={() => link.go("logs", { actor: u.phone_e164 })}>
            {t.viewLog}
          </button>
          <button className="btn small subtle" onClick={onClose}>
            {t.closeDetails}
          </button>
        </div>
      </div>
      <p className="muted-2">
        ID {shortId(u.id)} · {t.joinedAt}: {formatDateTime(u.created_at, lang)} · {t.lastLogin}:{" "}
        {u.last_login ? formatDateTime(u.last_login, lang) : t.never}
      </p>

      <div className="row-between">
        <h4>{t.businessesTab}</h4>
        {data.businesses.length > 0 && (
          <button className="btn small" onClick={() => link.go("businesses", { owner: u.id })}>
            {t.openEntity}
          </button>
        )}
      </div>
      {data.businesses.length === 0 ? (
        <p className="muted-2">{t.nothingHere}</p>
      ) : (
        <ul className="list">
          {data.businesses.slice(0, 8).map((b) => (
            <li key={b.id} className="row-between">
              <div className="min-w-0">
                <strong>{b.name}</strong> <StatusChip status={b.status} />
                <div className="muted-2">
                  {t.branchesCount}: {b.locations_count} · {t.campaignsCount}: {b.campaigns_count}
                </div>
              </div>
              <div className="row">
                <button className="btn small" onClick={() => link.go("placements", { business: b.id })}>
                  {t.viewPlacements}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4>{t.recentOrders}</h4>
      {data.orders.length === 0 ? (
        <p className="muted-2">{t.nothingHere}</p>
      ) : (
        <ul className="list">
          {data.orders.map((o) => (
            <li key={o.id} className="row-between">
              <div className="min-w-0 wrap-anywhere">
                {o.campaign_headline}
                <div className="muted-2">{formatDateTime(o.created_at, lang)}</div>
              </div>
              <div className="row">
                {formatMinor(o.amount_total, o.currency, lang)}
                <OrderChip state={o.state as OrderState} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4>{t.recentActivity}</h4>
      {data.activity.length === 0 ? (
        <p className="muted-2">{t.nothingHere}</p>
      ) : (
        <ul className="list">
          {data.activity.slice(0, 15).map((e) => (
            <li key={e.id} className="row-between">
              <div className="min-w-0">
                <code>{e.action}</code>
                <div className="muted-2">
                  {e.entity}:{shortId(e.entity_id)} · {e.actor_phone ?? t.system}
                </div>
              </div>
              <span className="muted-2">{formatDateTime(e.created_at, lang)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
