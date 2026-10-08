const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  materials: [], selected: null, workspace: "summary", flashcards: [], flashIndex: 0, flashRevealed: false,
  flashDifficult: new Set(), quiz: null, answers: {}, qIndex: 0, quizMode: "DEMO MODE", test: null,
  testAnswers: {}, mistakesTimer: null, editingMistake: null
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(window.__toast); window.__toast = setTimeout(() => el.classList.remove("show"), 2800);
}
async function api(url, options = {}) {
  try {
    const response = await fetch(url, options);
    let data = {}; try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.detail || "Something went wrong.");
    return data;
  } catch (error) {
    if (error.name === "TypeError") throw new Error("Lernyqo cannot reach the backend. Keep START.bat open and try again.");
    throw error;
  }
}
function showPage(id) {
  $$(".page").forEach((p) => p.classList.toggle("active", p.id === id));
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.page === id));
  $("#sidebar").classList.remove("mobile-open");
  if (id === "dashboard") loadDashboard();
  if (id === "lab") loadMaterials();
  if (id === "mistakes") loadMistakes();
  if (id === "exams") loadExams();
}
$$('.nav').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$("#mobileMenu").onclick = () => $("#sidebar").classList.toggle("mobile-open");

async function loadMode() {
  const h = await api("/api/health");
  const badge = $("#modeBadge");
  badge.textContent = h.ai_mode === "live" ? "GEMINI LIVE AI" : "DEMO MODE";
}

async function loadDashboard() {
  try {
    const d = await api("/api/dashboard");
    const stats = [
      ["Study materials", d.materials, "uploaded"], ["Flashcard sets", d.flashcards, "saved"],
      ["Quiz attempts", d.quizzes, "completed"], ["Practice tests", d.practice_tests, "generated"],
      ["Average quiz", `${d.average_quiz_score}%`, "actual attempts"], ["Open mistakes", d.open_mistakes, "need review"],
      ["Test attempts", d.test_attempts, "completed"], ["Fixed mistakes", d.fixed_mistakes, "resolved"],
    ];
    $("#stats").innerHTML = stats.map(([label, value, foot]) => `<div class="stat-card card"><div class="stat-label">${label}</div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${foot}</div></div>`).join("");
    $("#ring").textContent = `${d.exam_readiness}%`; $("#readinessBar").style.width = `${d.exam_readiness}%`;
    $("#nextExam").textContent = d.upcoming_exam || "No exam added";
    $("#examCountdown").textContent = d.days_remaining == null ? "Add an exam to build your revision timeline." : `${d.days_remaining} days remaining`;
    $("#nextActionTitle").textContent = d.next_action.title; $("#nextActionDetail").textContent = d.next_action.detail;
    $("#nextActionButton").onclick = () => showPage(d.next_action.page);
  } catch (e) { toast(e.message); }
}

async function loadMaterials() {
  try {
    state.materials = await api("/api/materials");
    $("#materialCount").textContent = `${state.materials.length} material${state.materials.length === 1 ? "" : "s"}`;
    $("#materials").innerHTML = state.materials.length ? state.materials.map((m) => {
      const ext = (m.filename.split(".").pop() || "FILE").toUpperCase();
      return `<article class="material-card card ${state.selected === m.id ? "selected" : ""}">
        <div class="material-top"><span class="file-pill">${escapeHtml(ext)}</span><span class="material-meta">${formatBytes(m.size_bytes)}</span></div>
        <h3>${escapeHtml(m.filename)}</h3><div class="material-meta">${new Date(m.created_at).toLocaleString()} · ${m.extracted_text_available ? "Text ready" : "No readable text"}</div>
        <div class="material-actions"><button class="open" onclick="selectMaterial(${m.id})">Open workspace →</button><button class="delete" onclick="removeMaterial(${m.id})">Delete</button></div>
      </article>`;
    }).join("") : `<div class="card empty" style="grid-column:1/-1"><strong>No materials yet.</strong><br>Upload your first study file to start the learning loop.</div>`;
    if (state.selected && !state.materials.some((m) => m.id === state.selected)) state.selected = null;
    if (state.selected) renderWorkspace();
  } catch (e) { toast(e.message); }
}
function formatBytes(bytes) { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1024/1024).toFixed(1)} MB`; }
function selectMaterial(id) { state.selected = id; state.workspace = "summary"; state.flashcards=[]; state.flashIndex=0; state.flashRevealed=false; renderWorkspace(); loadMaterials(); }

function renderWorkspace() {
  const material = state.materials.find((m) => m.id === state.selected);
  if (!material) { $("#labContent").innerHTML = ""; return; }
  $("#labContent").innerHTML = `<div class="selected-workspace card">
    <div class="workspace-head"><div class="workspace-title"><div class="workspace-icon">↗</div><div><h2>${escapeHtml(material.filename)}</h2><p>${material.extracted_text_available ? "Source text is ready for your learning loop." : "This file has no readable text."}</p></div></div><span class="workspace-mode" id="workspaceMode">READY</span></div>
    <div class="workspace-tabs">
      ${[["summary","Understand"],["concepts","Key concepts"],["flashcards","Flashcards"],["quiz","Quiz"],["test","Practice test"]].map(([id,label]) => `<button class="workspace-tab ${state.workspace===id?"active":""}" onclick="switchWorkspace('${id}')">${label}</button>`).join("")}
    </div><div class="workspace-body" id="workspaceBody"></div></div>`;
  renderWorkspaceBody();
}
function switchWorkspace(id) { state.workspace=id; renderWorkspace(); }
function setWorkspaceMode(mode) { const el=$("#workspaceMode"); if(el) el.textContent=mode; }
function workspaceLoading(label) { $("#workspaceBody").innerHTML = `<div class="empty">${escapeHtml(label)}<br><span class="muted">Lernyqo is working with your selected material.</span></div>`; }

async function renderWorkspaceBody() {
  const id = state.selected; if (!id) return;
  if (state.workspace === "summary") {
    $("#workspaceBody").innerHTML = `<div class="action-config"><div><span class="eyebrow">UNDERSTAND</span><h3>Build a revision-ready overview</h3></div><button class="primary-button" onclick="generateMaterial('summary')">Generate summary</button></div><div id="summaryResult" class="generated"><div class="empty">Generate a summary from this material.</div></div>`;
    await generateMaterial("summary", true); return;
  }
  if (state.workspace === "concepts") {
    $("#workspaceBody").innerHTML = `<div class="action-config"><div><span class="eyebrow">UNDERSTAND</span><h3>Find the ideas worth remembering</h3></div><button class="primary-button" onclick="generateMaterial('concepts')">Generate concepts</button></div><div id="conceptResult" class="generated"><div class="empty">Generate key concepts from this material.</div></div>`;
    await generateMaterial("concepts", true); return;
  }
  if (state.workspace === "flashcards") { renderFlashcardConfig(); return; }
  if (state.workspace === "quiz") { renderQuizConfig(); return; }
  if (state.workspace === "test") { renderTestConfig(); return; }
}

async function generateMaterial(kind, silent=false) {
  const target = kind === "summary" ? $("#summaryResult") : $("#conceptResult");
  if (!target) return;
  if (!silent) target.innerHTML = `<div class="empty">Generating ${kind}…</div>`;
  try {
    const d = await api(`/api/materials/${state.selected}/${kind}`, {method:"POST"}); setWorkspaceMode(d.mode);
    const c=d.content;
    if(kind === "summary") {
      const definitions = c.definitions?.length ? `<h3>Definitions</h3>${c.definitions.map(x=>`<div class="definition"><strong>${escapeHtml(x.term)}</strong><p>${escapeHtml(x.meaning)}</p></div>`).join("")}` : "";
      const formulas = c.formulas?.length ? `<h3>Formulas</h3><ul class="bullet-list">${c.formulas.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "";
      target.innerHTML = `<div class="generated"><h2>Revision summary</h2><p>${escapeHtml(c.summary)}</p><h3>Important points</h3><ul class="bullet-list">${c.important_points.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul><h3>Exam notes</h3><ul class="bullet-list">${c.exam_notes.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>${definitions}${formulas}</div>`;
    }
    else target.innerHTML = `<div class="concept-grid">${c.concepts.map(x=>`<article class="concept-card"><strong>${escapeHtml(x.concept)}</strong><p>${escapeHtml(x.explanation)}</p><small><b>Remember:</b> ${escapeHtml(x.important_rule)}<br><b>Why:</b> ${escapeHtml(x.why_it_matters)}</small></article>`).join("")}</div>`;
  } catch(e) { target.innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`; }
}

function renderFlashcardConfig() {
  $("#workspaceBody").innerHTML = `<div class="action-config"><div><span class="eyebrow">REMEMBER</span><h3>Turn your notes into active recall</h3><p class="muted">Choose a small deck and work through it one card at a time.</p></div><div class="config-group"><select class="select config-select" id="flashCount"><option value="5">5 cards</option><option value="10" selected>10 cards</option><option value="20">20 cards</option></select><button class="primary-button" onclick="generateFlashcards()">Build deck</button></div></div><div id="flashResult"><div class="empty">Choose a deck size to begin.</div></div>`;
}
async function generateFlashcards() {
  workspaceLoading("Building your flashcards…");
  try { const count=Number($("#flashCount")?.value || 10); const d=await api(`/api/materials/${state.selected}/flashcards`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({count})}); state.flashcards=d.content.cards; state.flashIndex=0;state.flashRevealed=false;state.flashDifficult=new Set();setWorkspaceMode(d.mode);renderFlashcards(); } catch(e){$("#workspaceBody").innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
}
function renderFlashcards(){
  const card=state.flashcards[state.flashIndex]; if(!card)return;
  $("#workspaceBody").innerHTML=`<div class="flash-shell"><div class="flash-card ${state.flashRevealed?"is-revealed":""}" onclick="flipFlashcard()"><div><div class="flash-question">${escapeHtml(state.flashRevealed?card.answer:card.question)}</div><div class="flash-answer">${state.flashRevealed?"Answer · click to flip":"Click to reveal answer"}</div></div></div><div class="flash-footer"><button onclick="prevFlashcard()" ${state.flashIndex===0?"disabled":""}>← Previous</button><span class="flash-meta">${state.flashIndex+1} / ${state.flashcards.length} · ${state.flashDifficult.has(state.flashIndex)?"Marked difficult":"Normal"}</span><button onclick="nextFlashcard()" ${state.flashIndex===state.flashcards.length-1?"disabled":""}>Next →</button></div><div style="text-align:center;margin-top:13px"><button class="text-button" onclick="toggleDifficult()">${state.flashDifficult.has(state.flashIndex)?"✓ Difficult":"Mark as difficult"}</button></div></div>`;
}
function flipFlashcard(){state.flashRevealed=!state.flashRevealed;renderFlashcards()}function prevFlashcard(){state.flashIndex=Math.max(0,state.flashIndex-1);state.flashRevealed=false;renderFlashcards()}function nextFlashcard(){state.flashIndex=Math.min(state.flashcards.length-1,state.flashIndex+1);state.flashRevealed=false;renderFlashcards()}function toggleDifficult(){state.flashDifficult.has(state.flashIndex)?state.flashDifficult.delete(state.flashIndex):state.flashDifficult.add(state.flashIndex);renderFlashcards()}

function renderQuizConfig(){
  $("#workspaceBody").innerHTML=`<div class="action-config"><div><span class="eyebrow">PRACTICE</span><h3>Find what you actually remember</h3><p class="muted">Every wrong answer becomes a possible revision target.</p></div><div class="config-group"><select class="select config-select" id="quizDifficulty"><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select><select class="select config-select" id="quizCount"><option value="5">5 questions</option><option value="10">10 questions</option><option value="15">15 questions</option><option value="20">20 questions</option></select><button class="primary-button" onclick="generateQuiz()">Start quiz</button></div></div><div class="empty">Pick your difficulty and question count, then start.</div>`;
}
async function generateQuiz(){
  workspaceLoading("Creating your quiz…");
  try { const difficulty=$("#quizDifficulty")?.value||"mixed",count=Number($("#quizCount")?.value||5);const d=await api(`/api/materials/${state.selected}/quiz`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({difficulty,count})});state.quiz=d.quiz;state.answers={};state.qIndex=0;state.quizMode=d.mode;setWorkspaceMode(d.mode);showPage("quiz");renderQuiz(); }catch(e){$("#workspaceBody").innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
}
function renderQuiz(){
  if(!state.quiz)return; const q=state.quiz.questions[state.qIndex];const progress=((state.qIndex)/state.quiz.question_count)*100;
  $("#quizContent").innerHTML=`<div class="card" style="padding:25px"><div class="badges"><span class="badge">${escapeHtml(state.quizMode)}</span><span class="badge">${escapeHtml(q.difficulty)}</span><span class="badge">${escapeHtml(q.topic)}</span></div><div class="quiz-progress"><span style="width:${progress}%"></span></div><div class="muted">Question ${state.qIndex+1} of ${state.quiz.question_count}</div><div class="quiz-question">${escapeHtml(q.question)}</div>${q.options.map((o,i)=>`<button class="option ${state.answers[q.id]===i?"selected":""}" onclick="answerQuiz(${q.id},${i})"><span class="option-index">${String.fromCharCode(65+i)}</span><span>${escapeHtml(o)}</span></button>`).join("")}<div class="quiz-bottom"><button class="text-button" onclick="showPage('lab')">Exit quiz</button><div>${state.qIndex?`<button class="secondary-button" onclick="state.qIndex--;renderQuiz()">← Back</button>`:""} <button class="primary-button" onclick="${state.qIndex===state.quiz.questions.length-1?"submitQuiz()":"nextQuiz()"}">${state.qIndex===state.quiz.questions.length-1?"Submit quiz":"Next →"}</button></div></div></div>`;
}
function answerQuiz(id,index){state.answers[id]=index;renderQuiz()}function nextQuiz(){const q=state.quiz.questions[state.qIndex];if(state.answers[q.id]===undefined)return toast("Choose an answer before continuing.");state.qIndex++;renderQuiz()}
async function submitQuiz(){const missing=state.quiz.questions.some(q=>state.answers[q.id]===undefined);if(missing)return toast("Answer every question before submitting.");try{const r=await api(`/api/quizzes/${state.quiz.id}/submit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({answers:state.answers})});renderQuizResult(r);loadDashboard()}catch(e){toast(e.message)}}
function renderQuizResult(r){$("#quizContent").innerHTML=`<div class="card" style="padding:25px"><span class="eyebrow">QUIZ COMPLETE</span><div class="result-score">${r.score}/${r.total}</div><div class="result-sub">${r.percentage}% · ${r.weak_topics.length?`Review: ${r.weak_topics.map(escapeHtml).join(", ")}`:"No weak topics detected"}</div>${r.weak_topics.length?`<div class="card" style="padding:14px;margin-top:18px;background:#f8fbfa"><strong>Recommended next step</strong><p class="muted" style="margin:5px 0 0">Add your wrong answers to the Mistake Notebook, then review them before another attempt.</p></div>`:""}<div class="result-grid">${r.results.map(x=>`<div class="result-item ${x.correct?"good":"bad"}"><div class="result-head"><strong>${x.correct?"✓ Correct":"✕ Review this"}</strong><span class="badge">${escapeHtml(x.topic)}</span></div><p>${escapeHtml(x.question)}</p><p>${escapeHtml(x.explanation)}</p>${!x.correct?`<button class="small-button" onclick='quickMistake(${JSON.stringify(x).replace(/'/g,"&#39;")})'>Add to Mistake Notebook</button>`:""}</div>`).join("")}</div><div style="margin-top:20px"><button class="secondary-button" onclick="showPage('mistakes')">Open Mistake Notebook →</button><button class="text-button" onclick="showPage('lab');selectMaterial(${state.selected})">Back to Study Lab</button></div></div>`}

function renderTestConfig(){
  $("#workspaceBody").innerHTML=`<div class="action-config"><div><span class="eyebrow">TEST</span><h3>Build a focused practice paper</h3><p class="muted">MCQs are auto-scored. Short answers are self-check so you still do the work.</p></div><div class="config-group"><select class="select config-select" id="testDifficulty"><option value="mixed">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select><select class="select config-select" id="testType"><option value="mixed">Mixed types</option><option value="mcq">MCQ only</option><option value="short">Short answer</option></select><select class="select config-select" id="testCount"><option value="3">3 questions</option><option value="5" selected>5 questions</option><option value="10">10 questions</option></select><button class="primary-button" onclick="generateTest()">Build test</button></div></div><div class="empty">Choose the paper settings and start when you're ready.</div>`;
}
async function generateTest(){workspaceLoading("Building your practice test…");try{const body={difficulty:$("#testDifficulty")?.value||"mixed",count:Number($("#testCount")?.value||5),question_type:$("#testType")?.value||"mixed"};const d=await api(`/api/materials/${state.selected}/test`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});state.test=d;state.testAnswers={};setWorkspaceMode(d.mode);showPage("tests");renderTest();}catch(e){$("#workspaceBody").innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}}
function renderTest(){const t=state.test;$("#testsContent").innerHTML=`<div class="card" style="padding:25px"><div class="badges"><span class="badge">${escapeHtml(t.mode)}</span><span class="badge">${escapeHtml(t.difficulty)}</span></div><h2 style="margin:12px 0 4px">${escapeHtml(t.title)}</h2><p class="muted">${t.question_count} questions · MCQs are scored automatically.</p>${t.questions.map((q,i)=>`<article class="test-question"><div class="muted">Question ${i+1} · ${escapeHtml(q.topic)}</div><h3>${escapeHtml(q.question)}</h3>${q.type==='mcq'?q.options.map((o,j)=>`<button class="option ${state.testAnswers[i]===j?"selected":""}" onclick="state.testAnswers[${i}]=${j};renderTest()"><span class="option-index">${String.fromCharCode(65+j)}</span><span>${escapeHtml(o)}</span></button>`).join(""):`<textarea class="textarea answer-input" rows="4" placeholder="Write your answer from memory…" oninput="state.testAnswers[${i}]=this.value">${escapeHtml(state.testAnswers[i]||"")}</textarea><div class="self-check">Short answer · self-check after submission. The model answer will be shown.</div>`}</article>`).join("")}<div class="quiz-bottom"><button class="text-button" onclick="showPage('lab')">Exit test</button><button class="primary-button" onclick="submitTest()">Submit practice test</button></div></div>`}
async function submitTest(){try{const r=await api(`/api/tests/${state.test.id}/submit`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({answers:state.testAnswers})});$("#testsContent").innerHTML=`<div class="card" style="padding:25px"><span class="eyebrow">TEST COMPLETE</span><div class="test-result"><div class="big">${r.percentage}%</div><div class="muted">${r.score}/${r.auto_scored} automatically scored MCQs · ${r.total-r.auto_scored} self-check question${r.total-r.auto_scored===1?"":"s"}</div></div>${r.results.map((x,i)=>`<div class="result-item ${x.correct===true?"good":x.correct===false?"bad":""}"><div class="result-head"><strong>${x.correct===true?"✓ Correct":x.correct===false?"✕ Review":"Self-check"}</strong><span class="badge">${escapeHtml(x.topic)}</span></div>${x.correct===false||x.correct===null?`<div class="test-answer"><b>Model answer:</b> ${escapeHtml(x.answer)}</div>`:""}</div>`).join("")}<div style="margin-top:20px"><button class="secondary-button" onclick="showPage('lab');selectMaterial(${state.selected})">Back to Study Lab</button></div></div>`;loadDashboard();}catch(e){toast(e.message)}}

async function quickMistake(x){try{await api("/api/mistakes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:x.question,error:"I answered this incorrectly.",fix:x.explanation,subject:"Study",confidence:"Low",topic:x.topic,source_material_id:state.selected})});toast("Added to Mistake Notebook.");loadDashboard();}catch(e){toast(e.message)}}

function openModal(title, eyebrow, body){$("#modalTitle").textContent=title;$("#modalEyebrow").textContent=eyebrow;$("#modalBody").innerHTML=body;$("#modalBackdrop").classList.add("open")}
function closeModal(event){if(event && event.target!==$("#modalBackdrop"))return;$("#modalBackdrop").classList.remove("open");state.editingMistake=null}
function openMistakeModal(mistake=null){state.editingMistake=mistake;const x=mistake||{};openModal(mistake?"Edit mistake":"Add mistake","MISTAKE NOTEBOOK",`<div class="form-stack"><div><div class="field-label">Question or concept</div><input class="input" id="mQuestion" value="${escapeHtml(x.question||"")}" placeholder="What did you get wrong?"></div><div><div class="field-label">What went wrong?</div><textarea class="textarea" id="mError" placeholder="Explain the gap or mistake.">${escapeHtml(x.error||"")}</textarea></div><div><div class="field-label">Correct approach</div><textarea class="textarea" id="mFix" placeholder="What should you do next time?">${escapeHtml(x.fix||"")}</textarea></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><div class="field-label">Subject</div><input class="input" id="mSubject" value="${escapeHtml(x.subject||"General")}"></div><div><div class="field-label">Confidence</div><select class="select" id="mConfidence"><option ${x.confidence==="Low"?"selected":""}>Low</option><option ${x.confidence==="Medium"?"selected":""}>Medium</option><option ${x.confidence==="High"?"selected":""}>High</option></select></div></div><div><div class="field-label">Topic</div><input class="input" id="mTopic" value="${escapeHtml(x.topic||"")}" placeholder="e.g. Nernst equation"></div><p class="hint">Keep this specific. Your future self should understand the mistake in 10 seconds.</p></div><div class="modal-actions"><button class="secondary-button" onclick="closeModal()">Cancel</button><button class="primary-button" onclick="saveMistake()">Save mistake</button></div>`)}
async function saveMistake(){const payload={question:$("#mQuestion").value.trim(),error:$("#mError").value.trim(),fix:$("#mFix").value.trim(),subject:$("#mSubject").value.trim(),confidence:$("#mConfidence").value,topic:$("#mTopic").value.trim()||null,source_material_id:state.selected||null,fixed:state.editingMistake?.fixed||false};if(!payload.question||!payload.error||!payload.fix||!payload.subject)return toast("Fill the question, mistake, fix and subject.");try{if(state.editingMistake)await api(`/api/mistakes/${state.editingMistake.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});else await api("/api/mistakes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});closeModal();loadMistakes();loadDashboard();toast(state.editingMistake?"Mistake updated.":"Mistake saved.");}catch(e){toast(e.message)}}
let mistakeSearchTimer=null;function debouncedMistakes(){clearTimeout(mistakeSearchTimer);mistakeSearchTimer=setTimeout(loadMistakes,220)}
async function loadMistakes(){try{const search=encodeURIComponent($("#mistakeSearch")?.value||"");const status=encodeURIComponent($("#mistakeStatus")?.value||"all");const rows=await api(`/api/mistakes?search=${search}&status=${status}`);$("#mistakesList").innerHTML=rows.length?rows.map(x=>`<article class="mistake-card card"><div class="mistake-top"><div><h3>${escapeHtml(x.question)}</h3><div class="badges"><span class="badge">${escapeHtml(x.subject)}</span><span class="badge">${escapeHtml(x.topic||"General")}</span><span class="badge warn">${escapeHtml(x.confidence)} confidence</span>${x.fixed?'<span class="badge fixed">Fixed</span>':''}</div></div><div class="mistake-actions"><button class="edit-button" onclick='openMistakeModal(${JSON.stringify(x).replace(/'/g,"&#39;")})'>Edit</button><button class="danger-button" onclick="deleteMistake(${x.id})">Delete</button></div></div><div class="mistake-section"><strong>What went wrong</strong><p>${escapeHtml(x.error)}</p></div><div class="mistake-section"><strong>Correct approach</strong><p>${escapeHtml(x.fix)}</p></div><div style="margin-top:13px"><button class="small-button" onclick="toggleFixed(${x.id})">${x.fixed?"Mark open":"Mark fixed"}</button></div></article>`).join(""):`<div class="card empty"><strong>No mistakes match this view.</strong><br>Wrong quiz answers can be saved here automatically.</div>`}catch(e){toast(e.message)}}
async function toggleFixed(id){try{await api(`/api/mistakes/${id}/fixed`,{method:"POST"});loadMistakes();loadDashboard();toast("Notebook updated.")}catch(e){toast(e.message)}}async function deleteMistake(id){if(!confirm("Delete this mistake?"))return;try{await api(`/api/mistakes/${id}`,{method:"DELETE"});loadMistakes();loadDashboard();toast("Mistake deleted.")}catch(e){toast(e.message)}}

async function loadExams(){try{const rows=await api("/api/exams");$("#examsList").innerHTML=rows.length?rows.map(x=>`<article class="exam-row card"><div><h3>${escapeHtml(x.name)}</h3><div class="exam-date">${new Date(`${x.exam_date}T00:00:00`).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"})}</div><div class="timeline">${timelineFor(x.days_remaining).map(s=>`<div class="timeline-step"><strong>${escapeHtml(s.when)}</strong><span>${escapeHtml(s.action)}</span></div>`).join("")}</div></div><div><div class="exam-days">${Math.max(0,x.days_remaining)}</div><div class="muted">days left</div><button class="danger-button" style="margin-top:10px" onclick="deleteExam(${x.id})">Delete</button></div></article>`).join(""):`<div class="card empty"><strong>No exams yet.</strong><br>Add your next exam to create a revision timeline.</div>`}catch(e){toast(e.message)}}
function timelineFor(days){if(days<=1)return[{when:"Today",action:"Mistake revision"}];if(days<=3)return[{when:"Now",action:"Review weak spots"},{when:"1 day",action:"Mistake revision"}];if(days<=7)return[{when:"Now",action:"Understand material"},{when:"3 days",action:"Quiz"},{when:"1 day",action:"Mistake revision"}];if(days<=14)return[{when:"Now",action:"Understand material"},{when:"7 days",action:"Flashcards"},{when:"3 days",action:"Quiz"},{when:"1 day",action:"Mistake revision"}];return[{when:"Now",action:"Understand material"},{when:"7 days",action:"Flashcards"},{when:"3 days",action:"Quiz"},{when:"1 day",action:"Mistake revision"}]}
async function addExam(){const name=$("#examName").value.trim(),exam_date=$("#examDate").value;if(!name||!exam_date)return toast("Enter an exam name and date.");try{await api("/api/exams",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,exam_date})});$("#examName").value="";$("#examDate").value="";loadExams();loadDashboard();toast("Preparation plan created.")}catch(e){toast(e.message)}}
async function deleteExam(id){if(!confirm("Delete this exam?"))return;try{await api(`/api/exams/${id}`,{method:"DELETE"});loadExams();loadDashboard();toast("Exam removed.")}catch(e){toast(e.message)}}

async function tryDemo(){showPage("lab");try{const m=await api("/api/materials/demo",{method:"POST"});state.selected=m.id;state.workspace="summary";await loadMaterials();toast("Demo material is ready.");}catch(e){toast(e.message)}}

async function upload(){const input=$("#fileInput"),file=input.files[0];if(!file)return toast("Choose a study file first.");const button=$("#uploadBtn");button.disabled=true;button.textContent="Processing…";try{const fd=new FormData();fd.append("file",file);const m=await api("/api/materials/upload",{method:"POST",body:fd});state.selected=m.id;state.workspace="summary";input.value="";$("#fileLabel").textContent="Drop a study file here";await loadMaterials();await loadDashboard();toast("Material uploaded and ready.");}catch(e){toast(e.message)}finally{button.disabled=false;button.textContent="Upload material"}}
async function removeMaterial(id){if(!confirm("Delete this material and its generated learning content?"))return;try{await api(`/api/materials/${id}`,{method:"DELETE"});if(state.selected===id)state.selected=null;await loadMaterials();await loadDashboard();toast("Material deleted.");}catch(e){toast(e.message)}}

const dropZone=$("#dropZone"), fileInput=$("#fileInput");fileInput?.addEventListener("change",()=>{const f=fileInput.files[0];if(f)$("#fileLabel").textContent=f.name});["dragenter","dragover"].forEach(ev=>dropZone?.addEventListener(ev,(e)=>{e.preventDefault();dropZone.classList.add("drag")}));["dragleave","drop"].forEach(ev=>dropZone?.addEventListener(ev,(e)=>{e.preventDefault();dropZone.classList.remove("drag")}));dropZone?.addEventListener("drop",(e)=>{const f=e.dataTransfer.files[0];if(f){fileInput.files=e.dataTransfer.files;$("#fileLabel").textContent=f.name}});

async function loadAll(){await Promise.all([loadMode(),loadDashboard(),loadMaterials(),loadMistakes(),loadExams()]);}
loadAll().catch((e)=>toast(e.message));

/* ------------------------------------------------------------------
   Lernyqo — Extreme Premium Interaction Layer
   Visual-only enhancement: no API/data/product logic is changed.
   ------------------------------------------------------------------ */
(() => {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches;

  const injectMotionChrome = () => {
    if (!document.querySelector(".scroll-progress")) {
      const progress = document.createElement("div");
      progress.className = "scroll-progress";
      progress.innerHTML = "<span></span>";
      document.body.appendChild(progress);
    }
    if (!reduceMotion && !coarse && !document.querySelector(".motion-cursor")) {
      const cursor = document.createElement("div");
      cursor.className = "motion-cursor";
      cursor.setAttribute("aria-hidden", "true");
      document.body.appendChild(cursor);
    }
  };

  injectMotionChrome();

  const setScrollProgress = () => {
    const bar = document.querySelector(".scroll-progress span");
    if (!bar) return;
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    bar.style.width = `${Math.min(100, Math.max(0, window.scrollY / scrollable * 100))}%`;
  };
  window.addEventListener("scroll", setScrollProgress, {passive:true});
  window.addEventListener("resize", setScrollProgress, {passive:true});
  setScrollProgress();

  // Mouse ambience is deliberately eased so it feels like a physical material, not a cursor effect.
  if (!reduceMotion && !coarse) {
    const cursorLayer = document.querySelector(".motion-cursor");
    let raf = 0;
    let px = window.innerWidth / 2;
    let py = window.innerHeight / 2;
    let cx = px, cy = py;
    const move = (e) => { px = e.clientX; py = e.clientY; document.documentElement.style.setProperty("--ambient-x", `${(px/window.innerWidth)*100}%`); document.documentElement.style.setProperty("--ambient-y", `${(py/window.innerHeight)*100}%`); if (!raf) raf = requestAnimationFrame(tick); };
    const tick = () => {
      cx += (px - cx) * .16;
      cy += (py - cy) * .16;
      document.documentElement.style.setProperty("--cursor-x", `${cx}px`);
      document.documentElement.style.setProperty("--cursor-y", `${cy}px`);
      if (cursorLayer) cursorLayer.style.setProperty("--cursor-active", "1");
      raf = 0;
    };
    document.addEventListener("mousemove", move, {passive:true});
    document.addEventListener("mouseleave", () => cursorLayer?.style.setProperty("--cursor-active", "0"));
  }

  const tiltTargets = [
    ".hero", ".loop-card", ".stat-card", ".material-card", ".next-action-card", ".exam-card",
    ".selected-workspace", ".concept-card", ".mistake-card", ".exam-row", ".flash-card"
  ].join(",");
  const magneticTargets = ".primary-button, .secondary-button, .material-actions button, .small-button, .edit-button, .danger-button, .ghost-button, .icon-button, .close-button, .workspace-tab";

  const enhanceTilt = (el) => {
    if (reduceMotion || coarse || el.dataset.motionTiltReady) return;
    el.dataset.motionTiltReady = "1";
    el.classList.add("motion-tilt");
    const strength = el.classList.contains("hero") ? 2.2 : el.classList.contains("flash-card") ? 4 : 2.8;
    let active = false;
    el.addEventListener("mouseenter", () => { active = true; });
    el.addEventListener("mouseleave", () => {
      active = false;
      el.style.removeProperty("--glare-x"); el.style.removeProperty("--glare-y");
      el.style.removeProperty("--rx"); el.style.removeProperty("--ry");
      el.classList.remove("motion-tilt-engaged");
    });
    el.addEventListener("mousemove", (e) => {
      if (!active) return;
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      const ry = (nx - .5) * strength * 2;
      const rx = -((ny - .5) * strength * 2);
      el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      el.style.setProperty("--glare-x", `${(nx*100).toFixed(1)}%`);
      el.style.setProperty("--glare-y", `${(ny*100).toFixed(1)}%`);
      el.classList.add("motion-tilt-engaged");
    }, {passive:true});
  };

  const engageTiltCss = document.createElement("style");
  engageTiltCss.textContent = `.motion-tilt-engaged{transform:perspective(1100px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateY(-3px) translateZ(0)!important;box-shadow:0 22px 55px rgba(16,34,42,.11)!important}`;
  document.head.appendChild(engageTiltCss);

  const enhanceMagnetic = (el) => {
    if (reduceMotion || coarse || el.dataset.magneticReady) return;
    el.dataset.magneticReady = "1";
    el.classList.add("motion-magnetic");
    let raf = 0;
    let tx = 0, ty = 0, x = 0, y = 0;
    const render = () => {
      x += (tx-x)*.24; y += (ty-y)*.24;
      el.style.setProperty("--mx", `${x.toFixed(2)}px`); el.style.setProperty("--my", `${y.toFixed(2)}px`);
      el.style.transform = `translate3d(var(--mx),var(--my),0)`;
      raf = (Math.abs(tx-x)+Math.abs(ty-y) > .1) ? requestAnimationFrame(render) : 0;
    };
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      tx = (e.clientX - (r.left+r.width/2)) / r.width * 5;
      ty = (e.clientY - (r.top+r.height/2)) / r.height * 4;
      if (!raf) raf = requestAnimationFrame(render);
    }, {passive:true});
    el.addEventListener("mouseleave", () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(render); });
  };

  const enhanceDropZone = (el) => {
    if (el.dataset.dropMotionReady) return;
    el.dataset.dropMotionReady = "1";
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--drop-x", `${e.clientX-r.left}px`);
      el.style.setProperty("--drop-y", `${e.clientY-r.top}px`);
    }, {passive:true});
  };

  const applyEnhancements = (root=document) => {
    if (root.nodeType === 1 && root.matches?.(tiltTargets)) enhanceTilt(root);
    if (root.nodeType === 1 && root.matches?.(magneticTargets)) enhanceMagnetic(root);
    if (root.nodeType === 1 && root.matches?.(".drop-zone")) enhanceDropZone(root);
    root.querySelectorAll?.(tiltTargets).forEach(enhanceTilt);
    root.querySelectorAll?.(magneticTargets).forEach(enhanceMagnetic);
    root.querySelectorAll?.(".drop-zone").forEach(enhanceDropZone);
    const buttons = [];
    if (root.nodeType === 1 && root.matches?.(".primary-button")) buttons.push(root);
    root.querySelectorAll?.(".primary-button").forEach((b) => buttons.push(b));
    buttons.forEach((b) => {
      if (!b.querySelector(".button-arrow") && /→/.test(b.textContent)) {
        const parts = [...b.childNodes];
        const text = parts.find(n => n.nodeType === 3 && n.textContent.includes("→"));
        if (text) text.textContent = text.textContent.replace("→", "");
        const arrow = document.createElement("span"); arrow.className = "button-arrow"; arrow.textContent = "→"; b.appendChild(arrow);
      }
    });
    root.querySelectorAll?.(".page.active").forEach((p) => p.classList.add("page-enter-strong"));
    root.querySelectorAll?.(".main").forEach((m) => m.classList.add("page-active-motion"));
  };

  const observe = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== "childList") continue;
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) applyEnhancements(node);
      });
    }
  });
  observe.observe(document.body, {subtree:true, childList:true});
  applyEnhancements();

  // Page changes: short exit, then the existing renderer, then a strong enter.
  const originalShowPage = window.showPage;
  if (typeof originalShowPage === "function" && !window.__premiumShowPageWrapped) {
    window.__premiumShowPageWrapped = true;
    window.showPage = (id) => {
      const current = document.querySelector(".page.active");
      if (!current || current.id === id || reduceMotion) {
        originalShowPage(id);
        requestAnimationFrame(() => applyEnhancements());
        return;
      }
      current.classList.add("page-leave");
      window.setTimeout(() => {
        current.classList.remove("page-leave");
        originalShowPage(id);
        const next = document.getElementById(id);
        next?.classList.remove("page-enter-strong");
        requestAnimationFrame(() => {
          next?.classList.add("page-enter-strong");
          document.querySelector(".main")?.classList.remove("page-active-motion");
          requestAnimationFrame(() => document.querySelector(".main")?.classList.add("page-active-motion"));
          applyEnhancements();
        });
      }, 150);
    };
  }

  // Make the hero copy and loop card breathe with pointer position.
  if (!reduceMotion && !coarse) {
    const hero = () => document.querySelector(".hero");
    document.addEventListener("mousemove", (e) => {
      const h = hero(); if (!h) return;
      const r = h.getBoundingClientRect();
      if (e.clientX < r.left-80 || e.clientX > r.right+80 || e.clientY < r.top-80 || e.clientY > r.bottom+80) return;
      const nx = (e.clientX - r.left) / r.width - .5;
      const ny = (e.clientY - r.top) / r.height - .5;
      h.style.setProperty("--hero-copy-x", `${(nx*5).toFixed(2)}px`);
      h.style.setProperty("--hero-copy-y", `${(ny*3).toFixed(2)}px`);
      h.style.setProperty("--loop-x", `${(-nx*8).toFixed(2)}px`);
      h.style.setProperty("--loop-y", `${(-ny*5).toFixed(2)}px`);
    }, {passive:true});
  }

  // Accessibility-friendly interaction pulse when toast appears.
  const toastEl = document.querySelector("#toast");
  if (toastEl) {
    const toastObserver = new MutationObserver(() => {
      if (toastEl.classList.contains("show")) {
        toastEl.classList.add("success-pulse");
        window.setTimeout(() => toastEl.classList.remove("success-pulse"), 900);
      }
    });
    toastObserver.observe(toastEl, {attributes:true, attributeFilter:["class"]});
  }
})();
