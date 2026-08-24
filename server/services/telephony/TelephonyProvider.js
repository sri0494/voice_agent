// TelephonyProvider — abstract interface for real phone-call providers.
// IMPORTANT: LeoMox must never claim to have placed a real call unless a real
// provider is configured via TELEPHONY_PROVIDER + credentials. The mock
// provider below simulates state transitions only, and every response it
// returns is tagged `mock: true` so the UI/API can clearly label it.
export class TelephonyProvider {
  async makeCall(_opts) { throw new Error("makeCall() not implemented"); }
  async receiveCall(_opts) { throw new Error("receiveCall() not implemented"); }
  async hangup(_callSid) { throw new Error("hangup() not implemented"); }
  async transfer(_callSid, _toNumber) { throw new Error("transfer() not implemented"); }
  async getCallStatus(_callSid) { throw new Error("getCallStatus() not implemented"); }
  async getRecording(_callSid) { throw new Error("getRecording() not implemented"); }
  isMock() { return true; }
}

export class MockTelephonyProvider extends TelephonyProvider {
  constructor() {
    super();
    this._calls = new Map();
  }

  async makeCall({ to, from, campaignId, agentId }) {
    const sid = `mock_call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._calls.set(sid, { sid, to, from, campaignId, agentId, status: "Ringing", startedAt: new Date() });
    return { providerCallId: sid, status: "Ringing", mock: true };
  }

  async receiveCall({ from, to }) {
    const sid = `mock_inbound_${Date.now()}`;
    this._calls.set(sid, { sid, to, from, status: "Connected", startedAt: new Date() });
    return { providerCallId: sid, status: "Connected", mock: true };
  }

  async hangup(callSid) {
    const call = this._calls.get(callSid);
    if (call) call.status = "Completed";
    return { status: "Completed", mock: true };
  }

  async transfer(callSid, toNumber) {
    const call = this._calls.get(callSid);
    if (call) call.status = "Transferred";
    return { status: "Transferred", transferredTo: toNumber, mock: true };
  }

  async getCallStatus(callSid) {
    const call = this._calls.get(callSid);
    return { status: call?.status || "Unknown", mock: true };
  }

  async getRecording(callSid) {
    return { url: null, mock: true, note: "No recording available in mock mode" };
  }

  isMock() { return true; }
}

export function createTelephonyProvider() {
  const provider = (process.env.TELEPHONY_PROVIDER || "mock").toLowerCase();
  switch (provider) {
    case "mock":
      return new MockTelephonyProvider();
    // case "exotel":     return new ExotelProvider({ apiKey: process.env.TELEPHONY_API_KEY, apiSecret: process.env.TELEPHONY_API_SECRET, from: process.env.TELEPHONY_PHONE_NUMBER });
    // case "knowlarity": return new KnowlarityProvider({ ... });
    // case "ozonetel":   return new OzonetelProvider({ ... });
    default:
      console.warn(`[telephony] Unknown TELEPHONY_PROVIDER="${provider}", falling back to mock. Real calls will NOT be made.`);
      return new MockTelephonyProvider();
  }
}
