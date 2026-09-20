package com.paytrace.demo;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class InvestigationServiceTest {
    @Test void evidenceIsCorrelatedAcrossServicesAndFeedbackPersists() throws Exception {
        var service=new InvestigationService(new ObjectMapper());
        var report=service.investigate(Map.of("transactionId","T202609200001","question","商户没有收到通知"));
        assertEquals("支付已成功，商户通知重试耗尽",report.get("title"));
        var evidence=(List<Map<String,Object>>)report.get("evidence");
        assertTrue(evidence.stream().anyMatch(e->"daemon".equals(e.get("service"))));
        assertFalse(evidence.stream().anyMatch(e->e.get("text").toString().contains("OTHER")));
        String id=report.get("id").toString();
        service.feedback(id,Map.of("status","已解决","note","测试反馈"));
        var reloaded=new InvestigationService(new ObjectMapper());
        assertEquals("已解决",((Map<?,?>)reloaded.report(id).get("feedback")).get("status"));
    }
    @Test void timeoutIsNotFailureAndDisabledSourceCannotProduceDefinitiveConclusion() throws Exception {
        var service=new InvestigationService(new ObjectMapper());
        assertEquals("待核实",service.investigate(Map.of("transactionId","T202609200003")).get("diagnosis"));
        assertEquals("渠道返回拒绝，具体发卡行原因待确认",service.investigate(Map.of("transactionId","T202609200002")).get("title"));
        var original=service.services();
        var disabled=service.services();disabled.forEach(s->s.put("enabled",false));
        try {service.configure(disabled);assertEquals("待核实",service.investigate(Map.of("transactionId","T202609200001")).get("diagnosis"));}
        finally {service.configure(original);}
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.investigate(Map.of("transactionId","T202609200001; pwd")));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.investigate(Map.of("transactionId","UNKNOWN")));
    }
}
