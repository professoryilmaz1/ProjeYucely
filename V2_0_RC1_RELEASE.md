<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0f172a" />
  <title>ProjeYucely</title>
  <link rel="stylesheet" href="/app/styles.css" />
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">IMPOCOR GROUP LLC</div>
        <h1>ProjeYucely</h1>
      </div>
      <button id="logoutBtn" class="ghost hidden">Çıkış</button>
    </header>

    <section id="authView" class="auth-grid">
      <article class="card hero-card">
        <span class="pill">LIFE ACTION SYSTEM</span>
        <h2>İhtiyacını söyle. Kazancı, yardımı ve sonraki adımı tek yerden yönet.</h2>
        <p>ONE BUTTON; NEED, EARN, Money Mission ve eşleşme akışlarını tek girişten başlatır.</p>
      </article>
      <article class="card auth-card">
        <div class="tabs">
          <button class="tab active" data-tab="login">Giriş</button>
          <button class="tab" data-tab="register">Kayıt</button>
        </div>
        <form id="loginForm" class="form-stack">
          <label>E-posta<input name="email" type="email" required autocomplete="email" /></label>
          <label>Şifre<input name="password" type="password" minlength="10" required autocomplete="current-password" /></label>
          <button class="primary" type="submit">Giriş yap</button>
        </form>
        <form id="registerForm" class="form-stack hidden">
          <label>Ad / görünen isim<input name="display_name" required /></label>
          <label>E-posta<input name="email" type="email" required autocomplete="email" /></label>
          <label>Şifre<input name="password" type="password" minlength="10" required autocomplete="new-password" /></label>
          <label>Şehir<input name="city" placeholder="Newark" /></label>
          <label>Beceriler<input name="skills" placeholder="dog_sitting, cleaning, driving" /></label>
          <button class="primary" type="submit">Hesap oluştur</button>
        </form>
        <p id="authError" class="error hidden"></p>
      </article>
    </section>

    <section id="appView" class="hidden">
      <div class="welcome-row">
        <div><div class="eyebrow">MERHABA</div><h2 id="welcomeName">Kullanıcı</h2></div>
        <div class="status-dot"><span></span> Sistem hazır</div>
      </div>

      <section class="metric-grid" aria-label="Hesap özeti">
        <article class="metric-card"><span>Aktif ihtiyaç</span><strong id="metricNeeds">0</strong><small>NEED</small></article>
        <article class="metric-card"><span>Müsaitlik</span><strong id="metricAvailability">0</strong><small>EARN</small></article>
        <article class="metric-card"><span>Fırsat</span><strong id="metricOpportunities">0</strong><small>OPEN</small></article>
        <article class="metric-card"><span>Son aksiyon</span><strong id="metricWorkflows">0</strong><small>WORKFLOW</small></article>
      </section>

      <article class="one-card">
        <div class="one-icon">1</div>
        <div class="one-label">ONE BUTTON</div>
        <h2>Bugün neyi çözmek istiyorsun?</h2>
        <p>Normal konuşur gibi yaz. ProjeYucely doğru motora yönlendirsin.</p>
        <form id="oneButtonForm">
          <textarea id="oneText" rows="4" placeholder="Örn: Bugün 1–5 arası boşum, para kazanmak istiyorum." required></textarea>
          <div class="one-actions"><button class="primary giant" type="submit">ÇÖZ</button></div>
        </form>
        <div class="chips">
          <button data-prompt="Köpeğime 4 saat bakıcı lazım $50">Yardım bul</button>
          <button data-prompt="Bugün 1-5 arası boşum para kazanmak istiyorum">Para kazan</button>
          <button data-prompt="Cuma gününe kadar $430 lazım">$430 bul</button>
          <button data-prompt="Evlenmek istiyorum, ciddi bir eş arıyorum">Eşleşme</button>
        </div>
      </article>

      <section class="dashboard-grid main-grid">
        <article class="card result-card">
          <div class="section-title"><h3>AI Sonucu</h3><span id="intentBadge" class="badge">Bekliyor</span></div>
          <div id="resultBox" class="empty-state">ONE BUTTON'a bir şey yazdığında uygulanabilir sonuç burada görünecek.</div>
        </article>
        <article class="card earn-card">
          <div class="section-title"><h3>EARN</h3><span class="badge green">Kazanç</span></div>
          <div id="earnSummary" class="metric">$0</div>
          <p class="muted">Bu oturumda bulunan potansiyel kazanç</p>
          <div id="opportunityList" class="list compact"><div class="empty-state small">Henüz fırsat yok.</div></div>
        </article>
      </section>

      <section class="dashboard-grid">
        <article class="card">
          <div class="section-title"><h3>Hızlı EARN Ayarı</h3><span class="badge">Müsaitlik</span></div>
          <form id="availabilityForm" class="inline-form">
            <label>Başlangıç<input name="start_time" placeholder="13:00" /></label>
            <label>Bitiş<input name="end_time" placeholder="17:00" /></label>
            <label>Min. ücret<input name="minimum_amount" type="number" min="0" placeholder="20" /></label>
            <button class="secondary" type="submit">Kaydet</button>
          </form>
          <p id="availabilityStatus" class="muted"></p>
        </article>
        <article class="card">
          <div class="section-title"><h3>Son Hareketler</h3><span class="badge">Canlı</span></div>
          <div id="recentActivity" class="list compact"><div class="empty-state small">Henüz hareket yok.</div></div>
        </article>
      </section>


      <section class="card life-hub">
        <div class="section-title"><h3>ProjeZZ Life Center</h3><span class="badge green">Daily 3 + What If + AI CFO</span></div>
        <div class="life-grid">
          <form id="lifeBudgetForm" class="life-form">
            <div class="section-title mini"><h4>Yaşam Bütçesi</h4><span id="lifeStatusBadge" class="badge">Hazır</span></div>
            <label>Aylık gelir<input name="monthly_income" type="number" min="0" step="0.01" placeholder="5000" /></label>
            <div class="life-expense-grid">
              <label>Konut<input name="housing" type="number" min="0" step="0.01" placeholder="1800" /></label>
              <label>Ulaşım<input name="transport" type="number" min="0" step="0.01" placeholder="600" /></label>
              <label>Gıda<input name="food" type="number" min="0" step="0.01" placeholder="700" /></label>
              <label>Diğer<input name="other" type="number" min="0" step="0.01" placeholder="400" /></label>
            </div>
            <button class="secondary" type="submit">Bütçeyi analiz et</button>
          </form>
          <div class="life-kpis">
            <article><span>Aylık denge</span><strong id="lifeBalance">$0</strong><small id="lifeBalanceStatus">Bekliyor</small></article>
            <article><span>Tasarruf oranı</span><strong id="lifeSavings">0%</strong><small>ProjeZZ</small></article>
            <article><span>Daily 3</span><strong id="daily3Count">0</strong><small>Bugünkü aksiyon</small></article>
          </div>
        </div>
        <div class="life-columns">
          <article class="life-panel">
            <div class="section-title mini"><h4>Daily 3</h4><span class="badge">3 çözüm</span></div>
            <div id="daily3List" class="list compact"><div class="empty-state small">Bütçeyi analiz ettiğinde bugünün 3 aksiyonu burada görünecek.</div></div>
          </article>
          <article class="life-panel">
            <div class="section-title mini"><h4>What If?</h4><span class="badge">Senaryo</span></div>
            <form id="whatIfForm" class="whatif-form">
              <label>Aylık gelir değişimi<input name="income_delta" type="number" step="0.01" placeholder="500" /></label>
              <label>Aylık gider değişimi<input name="expense_delta" type="number" step="0.01" placeholder="-200" /></label>
              <label>Tek seferlik maliyet<input name="one_time_cost" type="number" step="0.01" placeholder="1000" /></label>
              <button class="secondary" type="submit">Simüle et</button>
            </form>
            <div id="whatIfResult" class="empty-state small">Bir senaryo gir.</div>
          </article>
          <article class="life-panel">
            <div class="section-title mini"><h4>Fix My Day</h4><span class="badge green">Bugün</span></div>
            <button id="fixMyDayBtn" class="secondary" type="button">Bugünümü düzelt</button>
            <div id="fixMyDayList" class="list compact"><div class="empty-state small">Gün planı hazır değil.</div></div>
          </article>
          <article class="life-panel admin-cfo">
            <div class="section-title mini"><h4>AI CFO</h4><span class="badge">Admin</span></div>
            <p class="muted">Şirket finans motoru admin hesabında canlı hesaplanır.</p>
            <button id="cfoPreviewBtn" class="secondary" type="button">AI CFO durumunu kontrol et</button>
            <div id="cfoResult" class="empty-state small">Admin yetkisiyle kullanılabilir.</div>
          </article>
        </div>
      </section>

      <section class="card match-hub">
        <div class="section-title"><h3>Mutual Match</h3><span class="badge">İki taraflı eşleşme</span></div>
        <div class="match-tabs" id="matchTabs">
          <button class="match-tab active" data-match-type="RELATIONSHIP">Relationship</button>
          <button class="match-tab" data-match-type="BUSINESS">Business</button>
          <button class="match-tab" data-match-type="MENTOR">Mentor</button>
          <button class="match-tab" data-match-type="FRIEND">Friend</button>
        </div>
        <div class="match-layout">
          <form id="matchProfileForm" class="match-profile-form">
            <div class="match-form-grid">
              <label>Şehir<input name="city" placeholder="Newark" /></label>
              <label>Ülke<input name="country" placeholder="USA" /></label>
              <label>Yaş<input name="age" type="number" min="18" max="100" /></label>
              <label>Diller<input name="languages" placeholder="Turkish, English" /></label>
              <label>İlgi / beceri<input name="interests" placeholder="travel, business, volunteering" /></label>
              <label>Hedefler<input name="goals" placeholder="marriage, partnership, mentoring" /></label>
              <label>Aranan min. yaş<input name="age_min" type="number" min="18" max="100" /></label>
              <label>Aranan max. yaş<input name="age_max" type="number" min="18" max="100" /></label>
            </div>
            <label class="consent-row"><input name="discoverable" type="checkbox" checked /> Eşleşmelerde görünür ol</label>
            <label class="consent-row"><input name="opt_in" type="checkbox" required /> Bu eşleşme türü için açıkça katılıyorum</label>
            <button class="secondary" type="submit">Profili kaydet ve eşleşmeleri bul</button>
            <p id="matchStatus" class="muted"></p>
          </form>
          <div>
            <div class="section-title mini"><h4>Uygun eşleşmeler</h4><span id="matchCount" class="badge green">0</span></div>
            <div id="matchCards" class="match-cards"><div class="empty-state small">Henüz eşleşme yok.</div></div>
          </div>
        </div>
        <div class="connections-wrap">
          <div class="section-title mini"><h4>Bağlantılarım</h4><span class="badge">Onay durumu</span></div>
          <div id="connectionList" class="list compact"><div class="empty-state small">Henüz bağlantı yok.</div></div>
        </div>
      </section>

      <section class="dashboard-grid">
        <article class="card">
          <div class="section-title"><h3>NEED</h3><span class="badge">İhtiyaçlarım</span></div>
          <div id="needList" class="list compact"><div class="empty-state small">Henüz ihtiyaç yok.</div></div>
        </article>
        <article class="card">
          <div class="section-title"><h3>Güvenlik</h3><span class="badge green">Aktif</span></div>
          <div class="security-list">
            <div><strong>Oturum</strong><span>Hash'li token</span></div>
            <div><strong>Yetki</strong><span>Kullanıcı izolasyonu</span></div>
            <div><strong>Audit</strong><span>Kritik işlem kaydı</span></div>
            <div><strong>Rate limit</strong><span>Aktif</span></div>
          </div>
        </article>
      </section>
    </section>
  </main>
  <script type="module" src="/app/app.js"></script>
</body>
</html>
