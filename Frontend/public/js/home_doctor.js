(() => {
  function qs(id) {
    return document.getElementById(id);
  }

  function setVisible(el, visible) {
    if (!el) return;
    el.style.display = visible ? "" : "none";
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  async function fetchNextAppointment(signal) {
    const resp = await fetch("/api/doctor/next-appointment", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`next-appointment failed (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    return data && data.nextAppointment ? data.nextAppointment : null;
  }

  function renderNextAppointment(appt) {
    const emptyEl = qs("nextAppointmentEmpty");
    const detailsEl = qs("nextAppointmentDetails");
    const patientEl = qs("nextAppointmentPatient");
    const patientIdEl = qs("nextAppointmentPatientId");
    const timeEl = qs("nextAppointmentTime");
    const startBtn = qs("startConsultationBtn");

    if (!appt) {
      setVisible(detailsEl, false);
      setVisible(emptyEl, true);
      setText(emptyEl, "No appointment left");

      if (startBtn) {
        startBtn.disabled = true;
        startBtn.onclick = null;
        startBtn.style.display = "none";
      }
      return;
    }

    setVisible(emptyEl, false);
    setVisible(detailsEl, true);
    setText(patientEl, `${appt.firstname || ""} ${appt.lastname || ""}`.trim());
    setText(patientIdEl, appt.patientid);
    setText(timeEl, appt.Time);

    if (startBtn) {
      startBtn.disabled = false;
      startBtn.style.display = "";
      startBtn.onclick = () => {
        const pid = encodeURIComponent(String(appt.patientid));
        window.location.href = `/transcribe?patientId=${pid}`;
      };
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const card = qs("nextAppointmentCard");
    if (!card) return;

    const startBtn = qs("startConsultationBtn");
    const initialPatientId = startBtn?.dataset?.patientId;
    if (startBtn && initialPatientId) {
      startBtn.onclick = () => {
        const pid = encodeURIComponent(String(initialPatientId));
        window.location.href = `/transcribe?patientId=${pid}`;
      };
    }

    let inFlight = false;
    let controller = null;

    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;

      try {
        if (controller) controller.abort();
        controller = new AbortController();
        const appt = await fetchNextAppointment(controller.signal);
        renderNextAppointment(appt);
      } catch (err) {
        // Keep last known UI on transient failures.
        console.warn(err);
      } finally {
        inFlight = false;
      }
    };

    refresh();
    const intervalId = window.setInterval(refresh, 5000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });

    window.addEventListener("beforeunload", () => {
      window.clearInterval(intervalId);
      if (controller) controller.abort();
    });
  });
})();
