// Chatbot sederhana
const sendBtn = document.getElementById('sendBtn');
const userInput = document.getElementById('userInput');
const chatlog = document.getElementById('chatlog');

sendBtn.addEventListener('click', kirimPesan);
userInput.addEventListener('keypress', function (e) {
  if (e.key === 'Enter') kirimPesan();
});

function kirimPesan() {
  const pesan = userInput.value.trim();
  if (pesan === '') return;

  tambahChat('Kamu: ' + pesan);

  // Respon otomatis sederhana
  let jawaban = '';
  if (pesan.toLowerCase().includes('halo')) {
    jawaban = 'Halo! Ada yang bisa saya bantu hari ini?';
  } else if (pesan.toLowerCase().includes('produk')) {
    jawaban = 'Kami memiliki berbagai produk listrik seperti lampu, kabel, dan stop kontak.';
  } else if (pesan.toLowerCase().includes('terima kasih')) {
    jawaban = 'Sama-sama! 😊';
  } else {
    jawaban = 'Maaf, saya belum mengerti. Silakan coba pertanyaan lain.';
  }

  setTimeout(() => {
    tambahChat('Bot: ' + jawaban);
  }, 500);

  userInput.value = '';
}

function tambahChat(teks) {
  const p = document.createElement('p');
  p.textContent = teks;
  chatlog.appendChild(p);
  chatlog.scrollTop = chatlog.scrollHeight;
}

