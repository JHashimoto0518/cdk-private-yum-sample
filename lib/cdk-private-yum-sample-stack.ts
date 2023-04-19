import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2_tg from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets'
import { Construct } from 'constructs';

export class CdkPrivateYumSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // vpc
    const vpc = new ec2.Vpc(this, 'WebVpc', {
      vpcName: 'web-vpc',
      ipAddresses: ec2.IpAddresses.cidr('172.16.0.0/16'),
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED
        }
      ],
    });

    // add private endpoints for session manager
    vpc.addInterfaceEndpoint('SsmEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
    });
    vpc.addInterfaceEndpoint('SsmMessagesEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
    });
    vpc.addInterfaceEndpoint('Ec2MessagesEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
    });
    // add private endpoint for Amazon Linux repository on s3
    vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [
        { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }
      ]
    });

    //
    // security groups
    //
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for alb'
    })
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'allow http traffic from anyone')

    const ec2Sg = new ec2.SecurityGroup(this, 'WebEc2Sg', {
      vpc,
      allowAllOutbound: true,
      description: 'security group for a web server'
    })
    ec2Sg.connections.allowFrom(albSg, ec2.Port.tcp(80), 'allow http traffic from alb')

    //
    // web servers
    //
    const userData = ec2.UserData.forLinux({
      shebang: '#!/bin/bash',
    })
    userData.addCommands(
      // setup httpd
      'yum update -y',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      "sh -c 'echo \"This is a sample website.\" > /var/www/html/index.html'",
    )

    // launch one instance per az
    const targets: elbv2_tg.InstanceTarget[] = new Array();
    for (const [idx, az] of vpc.availabilityZones.entries()) {
      targets.push(
        new elbv2_tg.InstanceTarget(
          new ec2.Instance(this, `WebEc2${idx + 1}`, {
            instanceName: `web-ec2-${idx + 1}`,   // web-ec2-1, web-ec2-2, ...
            instanceType: new ec2.InstanceType('t2.micro'),
            machineImage: ec2.MachineImage.latestAmazonLinux({
              generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            }),
            vpc,
            vpcSubnets: vpc.selectSubnets({
              subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
            }),
            availabilityZone: az,
            securityGroup: ec2Sg,
            blockDevices: [
              {
                deviceName: '/dev/xvda',
                volume: ec2.BlockDeviceVolume.ebs(8, {
                  volumeType: ec2.EbsDeviceVolumeType.GP3,
                }),
              },
            ],
            userData,
            ssmSessionPermissions: true,
            propagateTagsToVolumeOnCreation: true,
          })
        )
      );
    }

    //
    // alb
    //
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      internetFacing: true,
      vpc,
      vpcSubnets: {
        subnets: vpc.publicSubnets
      },
      securityGroup: albSg
    })

    const listener = alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP
    })
    listener.addTargets('WebEc2Target', {
      targets,
      port: 80
    })

    // output test command
    new CfnOutput(this, 'TestCommand', {
      value: `curl http://${alb.loadBalancerDnsName}`
    })
  }
}
