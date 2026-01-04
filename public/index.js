document.addEventListener('DOMContentLoaded', function () {
    // 设置默认日期（当前日期和一年前）
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    document.getElementById('first-date').valueAsDate = oneYearAgo;
    document.getElementById('second-date').valueAsDate = today;

    // 方法切换
    const methodTabs = document.querySelectorAll('.method-tab');
    methodTabs.forEach(tab => {
        tab.addEventListener('click', function () {
            const method = this.getAttribute('data-method');

            // 更新标签状态
            methodTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');

            // 显示对应内容
            document.querySelectorAll('.method-content').forEach(content => {
                content.classList.remove('active');
            });
            document.getElementById(method + '-method').classList.add('active');

            // 清空结果
            clearResults();
        });
    });

    // 计算按钮事件
    document.getElementById('calculateBtn').addEventListener('click', calculateDoublingTime);

    // 输入变化时清空结果
    document.querySelectorAll('input').forEach(input => {
        input.addEventListener('change', clearResults);
        input.addEventListener('input', clearResults);
    });

    function clearResults() {
        document.getElementById('result-value').textContent = '-- 天';
        document.getElementById('result-description').textContent = '输入数据已更改，请重新计算';
        document.getElementById('calculation-steps').innerHTML = '等待重新计算...';
        document.getElementById('interpretation-text').textContent = '根据倍增时间结果，这里将显示临床意义解读。';
    }

    function calculateDoublingTime() {
        // 获取检查时间间隔
        const firstDate = new Date(document.getElementById('first-date').value);
        const secondDate = new Date(document.getElementById('second-date').value);

        if (isNaN(firstDate.getTime()) || isNaN(secondDate.getTime())) {
            alert('请输入有效的检查日期');
            return;
        }

        if (secondDate <= firstDate) {
            alert('第二次检查日期必须晚于第一次检查日期');
            return;
        }

        // 计算时间间隔（天）
        const timeDiff = secondDate.getTime() - firstDate.getTime();
        const daysDiff = Math.floor(timeDiff / (1000 * 3600 * 24));

        // 确定使用的方法
        const activeMethod = document.querySelector('.method-tab.active').getAttribute('data-method');

        let diameterRatio, volumeRatio, v1, v2;
        let steps = [];

        if (activeMethod === 'simple') {
            // 简单直径法
            const d1 = parseFloat(document.getElementById('first-diameter').value);
            const d2 = parseFloat(document.getElementById('second-diameter').value);

            if (d1 <= 0 || d2 <= 0) {
                alert('请输入有效的结节直径（大于0）');
                return;
            }

            if (d2 <= d1) {
                alert('第二次检查的结节直径应大于第一次检查');
                return;
            }

            diameterRatio = d2 / d1;
            steps.push(`第一步：计算直径变化比值 d₂/d₁ = ${d2.toFixed(1)} / ${d1.toFixed(1)} = ${diameterRatio.toFixed(3)}`);

            // 根据球体体积公式，体积比 = (d₂/d₁)³
            volumeRatio = Math.pow(diameterRatio, 3);
            steps.push(`第二步：计算体积变化比值 V₂/V₁ = (d₂/d₁)³ = (${diameterRatio.toFixed(3)})³ = ${volumeRatio.toFixed(3)}`);

        } else {
            // 三维体积法
            const l1 = parseFloat(document.getElementById('first-length').value);
            const w1 = parseFloat(document.getElementById('first-width').value);
            const h1 = parseFloat(document.getElementById('first-height').value);

            const l2 = parseFloat(document.getElementById('second-length').value);
            const w2 = parseFloat(document.getElementById('second-width').value);
            const h2 = parseFloat(document.getElementById('second-height').value);

            if ([l1, w1, h1, l2, w2, h2].some(val => val <= 0)) {
                alert('请输入有效的结节尺寸（大于0）');
                return;
            }

            // 计算体积（椭球体公式：V = (π/6) * 长 * 宽 * 高）
            v1 = (Math.PI / 6) * l1 * w1 * h1;
            v2 = (Math.PI / 6) * l2 * w2 * h2;

            steps.push(`第一步：计算第一次检查体积 V₁ = (π/6) × 长 × 宽 × 高 = (π/6) × ${l1.toFixed(1)} × ${w1.toFixed(1)} × ${h1.toFixed(1)} = ${v1.toFixed(1)} mm³`);
            steps.push(`第二步：计算第二次检查体积 V₂ = (π/6) × 长 × 宽 × 高 = (π/6) × ${l2.toFixed(1)} × ${w2.toFixed(1)} × ${h2.toFixed(1)} = ${v2.toFixed(1)} mm³`);

            if (v2 <= v1) {
                alert('第二次检查的结节体积应大于第一次检查');
                return;
            }

            volumeRatio = v2 / v1;
            steps.push(`第三步：计算体积变化比值 V₂/V₁ = ${v2.toFixed(1)} / ${v1.toFixed(1)} = ${volumeRatio.toFixed(3)}`);
        }

        // 计算倍增时间
        // 公式：DT = (ln(2) * t) / ln(V₂/V₁)
        const ln2 = Math.log(2);
        const lnVolumeRatio = Math.log(volumeRatio);

        steps.push(`第四步：计算自然对数 ln(V₂/V₁) = ln(${volumeRatio.toFixed(3)}) = ${lnVolumeRatio.toFixed(3)}`);
        steps.push(`第五步：应用公式 DT = [ln(2) × t] / ln(V₂/V₁) = [${ln2.toFixed(3)} × ${daysDiff}] / ${lnVolumeRatio.toFixed(3)}`);

        const doublingTime = (ln2 * daysDiff) / lnVolumeRatio;

        steps.push(`第六步：计算结果 DT = ${doublingTime.toFixed(1)} 天`);

        // 显示结果
        document.getElementById('result-value').textContent = `${doublingTime.toFixed(1)} 天`;
        document.getElementById('result-description').textContent = `基于${daysDiff}天时间间隔的计算结果`;

        // 显示计算步骤
        const stepsHtml = steps.map(step => `<div>${step}</div>`).join('');
        document.getElementById('calculation-steps').innerHTML = stepsHtml;

        // 显示临床解读
        let interpretation = '';
        if (doublingTime < 30) {
            interpretation = `该结节的倍增时间为${doublingTime.toFixed(1)}天，小于30天，通常提示感染、炎症或其他非肿瘤性过程。建议临床随访或进一步检查排除活动性炎症。`;
        } else if (doublingTime >= 100 && doublingTime <= 300) {
            interpretation = `该结节的倍增时间为${doublingTime.toFixed(1)}天，处于100-300天范围内，<strong>高度警惕恶性肿瘤的可能性</strong>。这是典型肺癌的生长速度范围，建议结合结节形态（分叶、毛刺等）和患者风险因素（吸烟史、家族史）综合评估，可能需要进一步检查或短期随访。`;
        } else if (doublingTime > 200 && doublingTime <= 600) {
            interpretation = `该结节的倍增时间为${doublingTime.toFixed(1)}天，结节大致处于微浸润或浸润性腺癌阶段。建议结合结节的形态学特征（边缘是否光滑、有无钙化等）和患者临床情况综合判断，按指南进行定期随访。`;
        } else {
            interpretation = `该结节的倍增时间为${doublingTime.toFixed(1)}天，大于600天，倾向于良性或低度恶性（如贴壁生长型腺癌）。大多数此类结节生长缓慢或长期稳定，可按常规随访计划进行。`;
        }

        document.getElementById('interpretation-text').innerHTML = interpretation;
    }
});
