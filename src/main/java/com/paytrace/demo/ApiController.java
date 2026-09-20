package com.paytrace.demo;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Semaphore;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final InvestigationService service;
    private final Semaphore slots = new Semaphore(2);
    public ApiController(InvestigationService service) { this.service=service; }
    @GetMapping("/transactions") public Object transactions() throws IOException { return service.transactions(); }
    @GetMapping("/services") public Object services() { return service.services(); }
    @PutMapping("/services") public Object configure(@RequestBody List<Map<String,Object>> body) throws IOException { return service.configure(body); }
    @GetMapping("/status") public Object status() { return service.modelStatus(); }
    @GetMapping("/investigations") public Object history() { return service.history(); }
    @GetMapping("/investigations/{id}") public Object report(@PathVariable String id) { return service.report(id); }
    @PostMapping("/investigations") public Object investigate(@RequestBody Map<String,String> body) throws IOException {
        if(!slots.tryAcquire()) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"排查任务繁忙，请稍后重试");
        try { return service.investigate(body); } finally { slots.release(); }
    }
    @PostMapping("/investigations/{id}/feedback") public Object feedback(@PathVariable String id,@RequestBody Map<String,String> body) throws IOException { return service.feedback(id,body); }
    @ExceptionHandler(ResponseStatusException.class) public ResponseEntity<?> bad(ResponseStatusException e) { return ResponseEntity.status(e.getStatusCode()).body(Map.of("message",Objects.toString(e.getReason(),"请求无效"))); }
    @ExceptionHandler(IOException.class) public ResponseEntity<?> io(IOException e) { return ResponseEntity.status(500).body(Map.of("message","数据源读取或保存失败，请检查本地文件和目录权限")); }
}

@Component
class DemoAccessFilter implements Filter {
    private final String password=System.getenv().getOrDefault("DEMO_PASSWORD", "");
    @Override public void doFilter(ServletRequest request,ServletResponse response,FilterChain chain) throws IOException,ServletException {
        HttpServletRequest req=(HttpServletRequest)request; HttpServletResponse res=(HttpServletResponse)response;
        res.setHeader("X-Content-Type-Options","nosniff"); res.setHeader("X-Frame-Options","DENY");
        res.setHeader("Referrer-Policy","no-referrer");
        res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
        if(!password.isEmpty()) {
            String expected="Basic "+Base64.getEncoder().encodeToString(("judge:"+password).getBytes(StandardCharsets.UTF_8));
            String actual=Objects.toString(req.getHeader("Authorization"), "");
            if(!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8))) {
                res.setHeader("WWW-Authenticate","Basic realm=\"PayTrace Demo\", charset=\"UTF-8\""); res.sendError(401); return;
            }
        }
        if(Set.of("POST","PUT","DELETE","PATCH").contains(req.getMethod())) {
            String origin=req.getHeader("Origin");
            String host=req.getHeader("Host");
            if(origin!=null && !origin.equals("http://"+host) && !origin.equals("https://"+host)) { res.sendError(403);return; }
            if(req.getContentType()==null || !req.getContentType().startsWith("application/json")) {res.sendError(415);return;}
            if(req.getContentLengthLong()>32768) {res.sendError(413);return;}
        }
        chain.doFilter(request,response);
    }
}
