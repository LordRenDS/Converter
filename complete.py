import urllib.request
try:
    urllib.request.urlopen('http://localhost:8000/plan_step_complete', data=b'')
except:
    pass
