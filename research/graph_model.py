"""Minimal directed GraphSAGE: each node aggregates incoming neighbours."""
import torch
from torch import nn

class GraphSAGE(nn.Module):
    def __init__(self):
        super().__init__();self.a=nn.Linear(10,24);self.b=nn.Linear(48,16);self.out=nn.Linear(16,1)
    def aggregate(self,x,edges):
        source,target=edges
        sums=torch.zeros_like(x);sums.index_add_(0,target,x[source])
        n=torch.zeros((x.size(0),1),device=x.device);n.index_add_(0,target,torch.ones((len(target),1),device=x.device))
        return sums/n.clamp(min=1)
    def forward(self,x,edges):
        h=torch.relu(self.a(torch.cat([x,self.aggregate(x,edges)],dim=1)))
        h=torch.relu(self.b(torch.cat([h,self.aggregate(h,edges)],dim=1)))
        return self.out(h).squeeze(-1)
