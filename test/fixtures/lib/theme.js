// 根绝对路径资源：验证预览服务把 root 挂在 / 上。
document.documentElement.dataset.fixtureScript = 'loaded'
const button = document.getElementById('go')
const state = document.getElementById('state')
if (button && state) {
  button.addEventListener('click', () => {
    state.textContent = '脚本已运行 ✓'
  })
}
