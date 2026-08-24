import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import * as api from "../services/api.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { LoadingState, ErrorState } from "../components/DataState.jsx";

export default function CampaignDetail() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [state, setState] = useState("loading");
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setState("loading");
    try {
      const [c, contactList] = await Promise.all([api.getCampaign(id), api.getContacts(id)]);
      setCampaign(c);
      setContacts(contactList);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadContactsCsv(file, id);
      alert(`Imported ${result.inserted} contacts (${result.skippedCount} skipped)`);
      load();
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleCall = async (contactId) => {
    try {
      await api.placeCall(id, contactId);
      alert("Call initiated");
    } catch (err) {
      alert(err.message);
    }
  };

  if (state === "loading") return <LoadingState label="Loading campaign..." />;
  if (state === "error") return <ErrorState onRetry={load} />;

  return (
    <div>
      <Link to="/campaigns" style={{ color: "var(--text-secondary)", fontSize: 13 }}>← Back to Campaigns</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 4 }}>
        <div className="section-title">{campaign.name}</div>
        <StatusBadge status={campaign.status} />
      </div>
      <div className="section-sub">{campaign.type} · {campaign.language} · Agent: {campaign.agent_name || "—"}</div>

      <div className="grid grid-cols-3" style={{ marginBottom: 20 }}>
        <div className="card"><div className="label" style={{ color: "var(--text-secondary)", fontSize: 12 }}>Retry Attempts</div><div style={{ fontSize: 22, fontWeight: 700 }}>{campaign.retry_attempts}</div></div>
        <div className="card"><div className="label" style={{ color: "var(--text-secondary)", fontSize: 12 }}>Contacts</div><div style={{ fontSize: 22, fontWeight: 700 }}>{contacts.length}</div></div>
        <div className="card"><div className="label" style={{ color: "var(--text-secondary)", fontSize: 12 }}>Calling Hours</div><div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{campaign.calling_hours?.start} – {campaign.calling_hours?.end}</div></div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 600 }}>Contacts</div>
        <div>
          <input ref={fileInput} type="file" accept=".csv" onChange={handleUpload} style={{ display: "none" }} />
          <button className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "⬆ Upload CSV"}
          </button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="card">No contacts yet. Upload a CSV with columns: name, phone, email, language.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Attempts</th><th>Outcome</th><th></th></tr></thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>{c.name || "—"}</td>
                  <td>{c.phone}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.call_attempts}</td>
                  <td>{c.outcome || "—"}</td>
                  <td><button className="btn btn-sm" onClick={() => handleCall(c.id)}>📞 Call</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
